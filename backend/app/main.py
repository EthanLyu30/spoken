"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.middleware import SelectiveGZipMiddleware
from app.core.observability import TelemetryMiddleware
from app.services.telemetry import TelemetrySink, configured_bootstrap_admin
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
from app.db import init_db

settings = get_settings()


@asynccontextmanager
async def lifespan(application):
    await asyncio.to_thread(configured_bootstrap_admin)
    sink = TelemetrySink() if get_settings().telemetry_enabled else None
    application.state.telemetry_sink = sink
    try:
        yield
    finally:
        if sink:
            await sink.close()
        application.state.telemetry_sink = None

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
    expose_headers=["X-Trace-Id"],
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
