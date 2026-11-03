"""Health-check endpoints: liveness and database readiness.

``/health`` stays a pure liveness probe so a database outage cannot make the
host restart the process. ``/ready`` deliberately touches the database: external
keepalive jobs can probe it without waking the service for every request.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
    }


@router.get("/ready")
def ready(response: Response, db: Session = Depends(get_db)) -> dict:
    """Liveness plus a real database round trip; used by the warm-up probe."""
    response.headers["Cache-Control"] = "no-store"
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {
        "status": "ok",
        "app": get_settings().app_name,
        "database": "ok",
    }
