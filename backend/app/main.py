"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from contextlib import AsyncExitStack, asynccontextmanager, suppress
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.middleware import SelectiveGZipMiddleware
from app.core.observability import TelemetryMiddleware
from app.services.telemetry import TelemetrySink, RetentionWorker, configured_bootstrap_admin
from app.services.deepseek import create_http_client
from app.api import admin, telemetry
from app.api import (
    asr,
    auth,
    chat,
    custom,
    daily,
    dictionary,
    feedback,
    health,
    hint,
    interview,
    practice,
    pronunciation,
    scenarios,
    sessions,
    tts,
    turn_correction,
    words,
)
from app.core.config import get_settings
from app.db import SessionLocal, init_db

settings = get_settings()

# Managed Postgres (Neon/Supabase) can suspend an idle compute. Every request
# then pays a 1-1.6 s reconnect before its first query. A tiny in-process probe
# keeps the pool and the database warm while the web service is running; the
# external keepalive remains responsible for waking the web service itself.
_DB_WARMUP_SECONDS = 240.0


def _ping_database() -> None:
    from sqlalchemy import text

    with SessionLocal() as db:
        db.execute(text("SELECT 1"))


async def _warm_database() -> None:
    while True:
        try:
            await asyncio.to_thread(_ping_database)
        except Exception as exc:  # a probe must never bring down the app
            logging.getLogger(__name__).warning(
                "Database warm-up failed: %s", type(exc).__name__
            )
        await asyncio.sleep(_DB_WARMUP_SECONDS)


async def _stop_warmer(task: asyncio.Task) -> None:
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


@asynccontextmanager
async def lifespan(application):
    try:
        async with AsyncExitStack() as resources:
            application.state.deepseek_http = await resources.enter_async_context(create_http_client())
            await asyncio.to_thread(configured_bootstrap_admin)
            sink = TelemetrySink() if get_settings().telemetry_enabled else None
            application.state.telemetry_sink = sink
            if sink:
                resources.push_async_callback(sink.close)
            retention = RetentionWorker()
            application.state.telemetry_retention = retention
            resources.push_async_callback(retention.close)
            await retention.start()
            if not get_settings().database_url.startswith("sqlite"):
                warmer = asyncio.create_task(_warm_database())
                resources.push_async_callback(_stop_warmer, warmer)
            yield
    finally:
        application.state.deepseek_http = None
        application.state.telemetry_sink = None
        application.state.telemetry_retention = None

app = FastAPI(
    title=f"{settings.app_name} API",
    description="Backend for the Spoken AI English speaking-practice tool.",
    version="0.1.0",
    lifespan=lifespan,
)

# Compress JSON API payloads (Render serves them uncompressed). Added before
# CORS so CORS stays the outermost middleware. Streaming chat and binary audio
# are excluded so token-by-token replies and already-compressed audio pass
# through untouched.
app.add_middleware(
    SelectiveGZipMiddleware,
    exclude_prefixes=("/api/chat/stream", "/api/tts"),
    minimum_size=500,
)
app.add_middleware(TelemetryMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Trace-Id", "Server-Timing"],
)

# API routes are mounted under /api
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(scenarios.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(turn_correction.router, prefix="/api")
app.include_router(dictionary.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(asr.router, prefix="/api")
app.include_router(pronunciation.router, prefix="/api")
app.include_router(hint.router, prefix="/api")
app.include_router(words.router, prefix="/api")
app.include_router(daily.router, prefix="/api")
app.include_router(custom.router, prefix="/api")
app.include_router(interview.router, prefix="/api")
app.include_router(practice.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(telemetry.router, prefix="/api")

# Create database tables (idempotent).
init_db()


@app.get("/")
def root() -> dict:
    return {
        "name": settings.app_name,
        "docs": "/docs",
        "health": "/api/health",
        "scenarios": "/api/scenarios",
    }
