"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    asr,
    chat,
    custom,
    daily,
    feedback,
    health,
    hint,
    interview,
    pronunciation,
    scenarios,
    sessions,
    tts,
    words,
)
from app.core.config import get_settings
from app.db import init_db

settings = get_settings()

app = FastAPI(
    title=f"{settings.app_name} API",
    description="Backend for the Spoken AI English speaking-practice tool.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes are mounted under /api
app.include_router(health.router, prefix="/api")
app.include_router(scenarios.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(feedback.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(tts.router, prefix="/api")
app.include_router(asr.router, prefix="/api")
app.include_router(pronunciation.router, prefix="/api")
app.include_router(hint.router, prefix="/api")
app.include_router(words.router, prefix="/api")
app.include_router(daily.router, prefix="/api")
app.include_router(custom.router, prefix="/api")
app.include_router(interview.router, prefix="/api")

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
