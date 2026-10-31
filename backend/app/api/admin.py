"""Owner-only read APIs. No public API can grant administrator access."""
from typing import Literal
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.deps import get_current_user
from app.db import get_db
from app.models.user import User
from app.models.telemetry import TelemetryRecord
from app.services.telemetry import conditions, is_admin, overview, serialize

router = APIRouter(prefix="/admin", tags=["admin"])


def get_admin_user(response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not is_admin(db, user.id):
        raise HTTPException(status_code=403, detail="仅管理员可访问运行看板")
    response.headers["Cache-Control"] = "no-store"
    return user


def filters(hours: int = Query(24, ge=1, le=336), source: Literal["server", "browser"] = "server",
            operation: str | None = Query(None, max_length=120), model: str | None = Query(None, max_length=100),
            release: str | None = Query(None, max_length=80), outcome: Literal["ok", "error", "timeout", "cancelled"] | None = None):
    return dict(hours=hours, source=source, operation=operation, model=model, release=release, outcome=outcome)


async def flush(request):
    sink = getattr(request.app.state, "telemetry_sink", None)
    if sink:
        await sink.flush()


@router.get("/overview", dependencies=[Depends(get_admin_user)])
async def get_overview(request: Request, options: dict = Depends(filters), db: Session = Depends(get_db)):
    await flush(request)
    return await asyncio.to_thread(_overview, request, options, db)


def _overview(request, options, db):
    from app.services.monitoring import visitor_summary, state_time
    data = overview(db, **options)
    data['visitors'] = visitor_summary(db, hours=options['hours'])
    sink = getattr(request.app.state, "telemetry_sink", None)
    oldest = db.scalar(select(func.min(TelemetryRecord.started_at)))
    source_count = db.scalar(select(func.count()).select_from(TelemetryRecord).where(TelemetryRecord.source == options["source"]))
    server_budget = get_settings().telemetry_max_records * 3 // 4
    source_budget = server_budget if options["source"] == "server" else get_settings().telemetry_max_records - server_budget
    data["collection"] = {"retention_days": get_settings().telemetry_retention_days,
        "max_records": get_settings().telemetry_max_records,
        "source_budget": source_budget, "at_capacity": source_count >= source_budget,
        "oldest_at": oldest.isoformat() + "Z" if oldest else None,
        "dropped_since_restart": sink.dropped if sink else 0,
        "write_errors_since_restart": sink.write_errors if sink else 0,
        "active": sink is not None and get_settings().telemetry_enabled}
    retention = getattr(request.app.state, 'telemetry_retention', None)
    data['collection']['cleanup'] = {'active': retention is not None,
        'interval_seconds': retention.interval_seconds if retention else 3600,
        'last_success_at': state_time(db, 'retention_cleaned'),
        'failures_since_restart': retention.failures if retention else 0}
    return data


@router.get("/traces", dependencies=[Depends(get_admin_user)])
async def list_traces(request: Request, options: dict = Depends(filters), db: Session = Depends(get_db),
                      limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=100000),
                      slow_first: bool = False):
    await flush(request)
    return await asyncio.to_thread(_list, options, db, limit, offset, slow_first)


def _list(options, db, limit, offset, slow_first):
    query = select(TelemetryRecord).where(*conditions(**options))
    order = TelemetryRecord.duration_ms.desc() if slow_first else TelemetryRecord.id.desc()
    records = db.scalars(query.order_by(order, TelemetryRecord.id.desc()).limit(limit).offset(offset)).all()
    total = db.scalar(select(func.count()).select_from(TelemetryRecord).where(*conditions(**options)))
    return {"items": [serialize(r) for r in records], "total": total}


@router.get("/traces/{trace_id}", dependencies=[Depends(get_admin_user)])
async def get_trace(trace_id: str, request: Request, db: Session = Depends(get_db)):
    await flush(request)
    return await asyncio.to_thread(_detail, trace_id, db)


def _detail(trace_id, db):
    row = db.scalar(select(TelemetryRecord).where(TelemetryRecord.trace_id == trace_id))
    if row is None:
        raise HTTPException(status_code=404, detail="调用记录不存在或已超过保留期")
    data = serialize(row, detail=True)
    data["related"] = [serialize(r) for r in db.scalars(select(TelemetryRecord).where(
        TelemetryRecord.interaction_id == row.interaction_id, TelemetryRecord.trace_id != row.trace_id
    ).order_by(TelemetryRecord.id).limit(30)).all()] if row.interaction_id else []
    return data
