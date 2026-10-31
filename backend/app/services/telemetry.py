"""Bounded best-effort collection and private read models."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import math
import hashlib

from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.models.telemetry import AdminAccount, AdminBootstrap, TelemetryRecord
from app.models.user import User


def is_admin(db: Session, user_id: int) -> bool:
    return db.get(AdminAccount, user_id) is not None


def grant_admin(db: Session, email: str) -> int:
    """Server-operator action only; never called by a public route."""
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        raise ValueError("Existing account not found; no user was created")
    if not is_admin(db, user.id):
        db.add(AdminAccount(user_id=user.id))
        db.commit()
    return user.id


def bootstrap_admin(db: Session, email: str, *, attempt: str = "") -> int | None:
    """Consume once, including a missing-account result. Registration never grants."""
    normalized = email.strip().lower()
    if not normalized:
        return None
    # Keep legacy markers valid. A new attempt requires an explicit server
    # configuration change; restarting or registering never retries a marker.
    attempt = attempt.strip()
    identity = json.dumps([normalized, attempt], separators=(',', ':')) if attempt else normalized
    digest = hashlib.sha256(identity.encode('utf-8')).hexdigest()
    if db.get(AdminBootstrap, digest) is not None:
        return None
    user = db.scalar(select(User).where(User.email == normalized))
    uid = user.id if user else None
    if user and not is_admin(db, uid):
        db.add(AdminAccount(user_id=uid))
    db.add(AdminBootstrap(email_digest=digest, user_id=uid))
    # Grant and consumed marker are committed atomically.
    db.commit()
    return uid


def configured_bootstrap_admin():
    settings = get_settings()
    email = settings.admin_bootstrap_email
    if not email.strip():
        return
    try:
        with SessionLocal() as db:
            uid = bootstrap_admin(db, email, attempt=settings.admin_bootstrap_attempt)
            if uid is not None:
                logging.getLogger(__name__).info('Administrator bootstrap bound an existing account')
    except SQLAlchemyError as exc:
        logging.getLogger(__name__).warning('Administrator bootstrap unavailable: %s', type(exc).__name__)


def persist_batch(records: list[dict]) -> None:
    settings = get_settings()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=settings.telemetry_retention_days)
    with SessionLocal() as db:
        db.add_all(TelemetryRecord(**r) for r in records)
        db.flush()
        db.execute(delete(TelemetryRecord).where(TelemetryRecord.started_at < cutoff))
        # Browser samples cannot exhaust the retention budget of trusted traces.
        server_budget = settings.telemetry_max_records * 3 // 4
        for source, budget in (("server", server_budget), ("browser", settings.telemetry_max_records - server_budget)):
            oldest = db.scalar(select(TelemetryRecord.id).where(TelemetryRecord.source == source)
                .order_by(TelemetryRecord.id.desc()).offset(budget).limit(1))
            if oldest is not None:
                db.execute(delete(TelemetryRecord).where(TelemetryRecord.source == source, TelemetryRecord.id <= oldest))
        db.commit()


class TelemetrySink:
    def __init__(self, capacity=1000):
        self.queue = asyncio.Queue(maxsize=capacity)
        self.dropped = 0
        self.write_errors = 0
        self.closed = False
        self.worker = asyncio.create_task(self._run())

    def submit(self, record: dict) -> bool:
        if self.closed:
            self.dropped += 1
            return False
        try:
            self.queue.put_nowait(record)
            return True
        except asyncio.QueueFull:
            self.dropped += 1
            return False

    async def _run(self):
        while True:
            item = await self.queue.get()
            if item is None:
                self.queue.task_done()
                break
            batch = [item]
            stopping = False
            while len(batch) < 100 and not self.queue.empty():
                next_item = self.queue.get_nowait()
                if next_item is None:
                    self.queue.task_done()
                    stopping = True
                    break
                batch.append(next_item)
            try:
                await asyncio.to_thread(persist_batch, batch)
            except Exception as exc:
                self.dropped += len(batch)
                self.write_errors += 1
                logging.getLogger(__name__).warning("Telemetry write failed: %s", type(exc).__name__)
            finally:
                for _ in batch:
                    self.queue.task_done()
            if stopping:
                break

    async def flush(self):
        try:
            await asyncio.wait_for(self.queue.join(), timeout=2)
        except TimeoutError:
            pass

    async def close(self):
        self.closed = True
        await self.flush()
        # The sentinel is only added after queued writes; the worker owns it.
        try:
            await asyncio.wait_for(self.queue.put(None), timeout=2)
            await asyncio.wait_for(self.worker, timeout=5)
        except TimeoutError:
            self.dropped += self.queue.qsize()
            self.worker.cancel()
            try:
                await self.worker
            except asyncio.CancelledError:
                pass


def percentiles(values):
    ordered = sorted(v for v in values if v is not None)
    return {f"p{p}": ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)] if ordered else None
            for p in (50, 95, 99)}


def conditions(hours=24, source="server", operation=None, model=None, release=None, outcome=None):
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
    filters = [TelemetryRecord.started_at >= cutoff, TelemetryRecord.source == source]
    for column, value in [(TelemetryRecord.operation, operation), (TelemetryRecord.model, model),
                          (TelemetryRecord.release, release), (TelemetryRecord.outcome, outcome)]:
        if value:
            filters.append(column == value)
    return filters


def serialize(record, *, detail=False):
    out = {key: getattr(record, key) for key in ("trace_id", "interaction_id", "operation", "source", "outcome", "duration_ms",
        "http_status", "ttft_ms", "model", "input_tokens", "output_tokens", "release")}
    out["started_at"] = record.started_at.isoformat(timespec="milliseconds") + "Z"
    if detail:
        out["spans"] = json.loads(record.spans_json)
    return out


def overview(db, **filters):
    rows = db.execute(select(TelemetryRecord.duration_ms, TelemetryRecord.ttft_ms,
        TelemetryRecord.outcome, TelemetryRecord.input_tokens, TelemetryRecord.output_tokens,
        TelemetryRecord.started_at, TelemetryRecord.operation).where(*conditions(**filters))).all()
    completed = [r for r in rows if r.outcome != "cancelled"]
    known = [r for r in rows if r.input_tokens is not None and r.output_tokens is not None]
    buckets = {}
    for row in rows:
        key = row.started_at.replace(minute=0, second=0, microsecond=0).isoformat() + "Z"
        bucket = buckets.setdefault((key, row.operation), [])
        bucket.append(row)
    facet_filters = conditions(hours=filters.get("hours", 24), source=filters.get("source", "server"))
    facets = {name: list(db.scalars(select(column).where(*facet_filters, column.is_not(None))
                                  .distinct().order_by(column).limit(100)).all())
              for name, column in (("operations", TelemetryRecord.operation), ("models", TelemetryRecord.model), ("releases", TelemetryRecord.release))}
    return {"source": filters.get("source", "server"), "count": len(rows), "facets": facets,
        "success_rate": sum(r.outcome == "ok" for r in completed) / len(completed) if completed else None,
        "errors": sum(r.outcome == "error" for r in rows), "timeouts": sum(r.outcome == "timeout" for r in rows),
        "cancelled": sum(r.outcome == "cancelled" for r in rows),
        "latency": percentiles(r.duration_ms for r in completed), "ttft": percentiles(r.ttft_ms for r in rows),
        "ttft_known": sum(r.ttft_ms is not None for r in rows),
        "input_tokens": sum(r.input_tokens for r in known) if known else None,
        "output_tokens": sum(r.output_tokens for r in known) if known else None, "usage_known": len(known),
        "operations": sorted({r.operation for r in rows}),
        "trend": [{"time": time, "operation": op, "count": len(group),
                   "p95": percentiles(r.duration_ms for r in group if r.outcome != "cancelled")["p95"]}
                  for (time, op), group in sorted(buckets.items())]}
