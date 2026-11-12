"""Bounded best-effort collection and private read models."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import math
import hashlib
from statistics import median

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import SessionLocal
from app.models.telemetry import AdminAccount, AdminBootstrap, TelemetryRecord
from app.models.user import User


TEST_RETENTION_DIVISOR = 10

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


def source_budgets():
    maximum = get_settings().telemetry_max_records
    server = maximum * 3 // 4
    return {"server": server, "browser": maximum - server}


def retained_sources(db):
    rows = {source: (count, tests, oldest) for source, count, tests, oldest in db.execute(
        select(TelemetryRecord.source, func.count(), func.count(TelemetryRecord.test_run_id),
               func.min(TelemetryRecord.started_at)).group_by(TelemetryRecord.source)
    )}
    sources = {}
    for source, budget in source_budgets().items():
        count, tests, oldest = rows.get(source, (0, 0, None))
        sources[source] = {"source_budget": budget, "retained": count, "at_capacity": count >= budget,
                           "test_budget": budget // TEST_RETENTION_DIVISOR, "test_retained": tests,
                           "oldest_at": oldest.isoformat(timespec="seconds") + "Z" if oldest else None}
    return sources


def _trim_trace_partition(db, source, *, marked: bool, limit: int) -> None:
    record = TelemetryRecord
    test_scope = record.test_run_id.is_not(None) if marked else record.test_run_id.is_(None)
    partition = (record.source == source, test_scope)
    first_excess = (select(record.id).where(*partition)
                    .order_by(record.id.desc()).offset(limit).limit(1).scalar_subquery())
    db.execute(delete(record).where(*partition, record.id <= first_excess).execution_options(synchronize_session=False))


def _prune_traces(db, now) -> None:
    if db.get_bind().dialect.name == "postgresql":
        # Serialize capacity pruning through commit across writers and cleanup.
        db.connection().exec_driver_sql("SELECT pg_advisory_xact_lock(783461903)")
    record = TelemetryRecord
    cutoff = now - timedelta(days=get_settings().telemetry_retention_days)
    db.execute(delete(record).where(record.started_at < cutoff))
    counts = {source: (total, tests) for source, total, tests in db.execute(
        select(record.source, func.count(), func.count(record.test_run_id)).group_by(record.source)
    )}
    for source, budget in source_budgets().items():
        total, tests = counts.get(source, (0, 0))
        unmarked = total - tests
        test_limit = min(budget // TEST_RETENTION_DIVISOR, max(0, budget - unmarked))
        if tests > test_limit:
            _trim_trace_partition(db, source, marked=True, limit=test_limit)
        if unmarked > budget:
            _trim_trace_partition(db, source, marked=False, limit=budget)


def persist_batch(records: list[dict]) -> None:
    with SessionLocal() as db:
        if records:
            insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
            db.execute(insert(TelemetryRecord).on_conflict_do_nothing(index_elements=["trace_id"]), records)
        _prune_traces(db, datetime.now(timezone.utc).replace(tzinfo=None))
        db.commit()


def cleanup_retained_data():
    from app.services.monitoring import initialize_visitors, mark_state, prune_visits, utcnow
    with SessionLocal() as db:
        now = utcnow()
        initialize_visitors(db, now)
        _prune_traces(db, now)
        prune_visits(db, now)
        mark_state(db, 'retention_cleaned', now)
        db.commit()


class RetentionWorker:
    """Startup and idle cleanup; no dependence on incoming measurements."""
    def __init__(self, interval_seconds=3600, cleanup=None):
        self.interval_seconds = interval_seconds
        self.cleanup = cleanup or cleanup_retained_data
        self.failures = 0
        self.stop = asyncio.Event()
        self.worker = None

    async def sweep(self):
        try:
            await asyncio.to_thread(self.cleanup)
        except Exception as exc:
            self.failures += 1
            logging.getLogger(__name__).warning('Monitoring cleanup failed: %s', type(exc).__name__)

    async def start(self):
        await self.sweep()
        self.worker = asyncio.create_task(self._run())

    async def _run(self):
        while not self.stop.is_set():
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=self.interval_seconds)
            except TimeoutError:
                await self.sweep()

    async def close(self):
        self.stop.set()
        if self.worker is not None:
            try:
                await asyncio.wait_for(self.worker, timeout=5)
            except TimeoutError:
                self.worker.cancel()


class TelemetrySink:
    def __init__(self, capacity=1000):
        self.queue: asyncio.Queue[tuple[dict, asyncio.Future[bool] | None] | None] = asyncio.Queue(maxsize=capacity)
        self.dropped = 0
        self.write_errors = 0
        self.closed = False
        self.worker = asyncio.create_task(self._run())

    def submit(self, record: dict, *, receipt: asyncio.Future[bool] | None = None) -> bool:
        if self.closed:
            self.dropped += 1
            return False
        try:
            self.queue.put_nowait((record, receipt))
            return True
        except asyncio.QueueFull:
            self.dropped += 1
            return False

    async def submit_persisted(self, record: dict) -> bool:
        """Acknowledge only after the batch commits, including idempotent replays."""
        receipt = asyncio.get_running_loop().create_future()
        if not self.submit(record, receipt=receipt):
            return False
        try:
            return await asyncio.wait_for(receipt, timeout=6)
        except TimeoutError:
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
            stored = False
            try:
                await asyncio.to_thread(persist_batch, [record for record, _ in batch])
                stored = True
            except Exception as exc:
                self.dropped += len(batch)
                self.write_errors += 1
                logging.getLogger(__name__).warning("Telemetry write failed: %s", type(exc).__name__)
            finally:
                for _, receipt in batch:
                    if receipt is not None and not receipt.done():
                        receipt.set_result(stored)
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


def conditions(hours=24, source="server", operation=None, model=None, release=None, outcome=None,
               traffic="all", test_run_id=None, delivery="all"):
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=hours)
    filters = [TelemetryRecord.started_at >= cutoff, TelemetryRecord.source == source]
    for column, value in [(TelemetryRecord.operation, operation), (TelemetryRecord.model, model),
                          (TelemetryRecord.release, release), (TelemetryRecord.outcome, outcome)]:
        if value:
            filters.append(column == value)
    if source == "browser" and delivery == "replay":
        filters.append(TelemetryRecord.is_replay.is_(True))
    if test_run_id:
        filters.append(TelemetryRecord.test_run_id == test_run_id)
    elif traffic == "unmarked":
        filters.append(TelemetryRecord.test_run_id.is_(None))
    elif traffic == "test":
        filters.append(TelemetryRecord.test_run_id.is_not(None))
    return filters


def _read_spans(raw):
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def experience_summary(db, *, hours, release=None, server_release=None, browser_release=None,
                       traffic="all", test_run_id=None):
    # A current-release view can span two independently deployed versions:
    # server-side model timing and browser-side playback timing. "__all" means
    # the caller knows that side's current version is unknown; it must not
    # inherit the other side's main release filter.
    server_release = None if server_release == "__all" else server_release or release
    browser_release = None if browser_release == "__all" else browser_release or release
    stages = {key: [] for key in (
        "model.first_text", "chat.first_text", "chat.complete", "speech.request_to_audio",
    )}
    stages["model.first_text"] = list(db.scalars(select(TelemetryRecord.ttft_ms).where(
        *conditions(hours=hours, source="server", release=server_release,
                    operation="POST /api/chat/stream", outcome="ok", traffic=traffic, test_run_id=test_run_id),
        TelemetryRecord.ttft_ms.is_not(None),
    )))
    playback = dict(completed=0, failed=0, cancelled=0, classified=0, never_started=0,
                    recovered=0, recovery_failed=0, recovery_cancelled=0)
    timings = ("chat.first_text", "chat.complete", "speech.request_to_audio")
    for row in db.execute(select(TelemetryRecord.operation, TelemetryRecord.duration_ms,
        TelemetryRecord.outcome, TelemetryRecord.spans_json).where(
        *conditions(hours=hours, source="browser", release=browser_release,
                    traffic=traffic, test_run_id=test_run_id),
        TelemetryRecord.operation.in_((*timings, "speech.complete")),
    )):
        if row.operation != "speech.complete":
            if row.outcome == "ok":
                stages[row.operation].append(row.duration_ms)
            continue
        result = {"ok": "completed", "error": "failed", "cancelled": "cancelled"}.get(row.outcome)
        if result is None:
            continue
        playback[result] += 1
        attributes = next((span["attributes"] for span in _read_spans(row.spans_json)
                           if isinstance(span, dict) and span.get("name") == "speech.complete"
                           and isinstance(span.get("attributes"), dict)), {})
        started = attributes.get("playback_started")
        if isinstance(started, bool) and result != "cancelled":
            playback["classified"] += 1
            if not started and result == "failed":
                playback["never_started"] += 1
        if attributes.get("reason") in ("startup_timeout", "end_before_start", "speech_error"):
            playback[{"completed": "recovered", "failed": "recovery_failed", "cancelled": "recovery_cancelled"}[result]] += 1
    return {
        "stages": [{"operation": operation, "samples": len(values), **percentiles(values)}
                   for operation, values in stages.items()],
        "playback": playback,
    }


def serialize(record, *, detail=False):
    from app.services.model_pricing import record_reference_cost
    out = {key: getattr(record, key) for key in ("trace_id", "interaction_id", "operation", "source", "outcome", "duration_ms",
        "http_status", "ttft_ms", "model", "input_tokens", "output_tokens", "release",
        "error_type", "error_cause_type", "test_run_id")}
    if record.guest_subject_hash and not record.test_run_id:
        out["audience"] = "guest"
    out["started_at"] = record.started_at.isoformat(timespec="milliseconds") + "Z"
    if record.source == "browser":
        out["is_replay"] = record.is_replay
    spans = None
    if detail or not out["model"]:
        spans = _read_spans(record.spans_json)
        if not out["model"]:
            out["model"] = next((
                attributes["model"]
                for node in spans
                if isinstance(node, dict) and node.get("name") == "pronunciation.assess"
                for attributes in [node.get("attributes")]
                if isinstance(attributes, dict) and attributes.get("model") in ("en_vip", "cn_vip")
            ), None)
    cost = record_reference_cost(record, source=record.source)
    out['cost_min_cny'] = cost[0] if cost is not None else None
    out['cost_max_cny'] = cost[1] if cost is not None else None
    if detail:
        out["spans"] = spans
        if record.source == "browser":
            out["occurred_at"] = out["started_at"] if record.received_at is not None else None
            received = record.received_at or record.started_at
            out["received_at"] = received.isoformat(timespec="milliseconds") + "Z"
    return out


def _asr_replay_summary(db, **filters):
    # Compare replays with all ASR failures in the selected scope.
    scope = filters | {"delivery": "all", "outcome": None}
    rows = db.execute(select(TelemetryRecord.is_replay, TelemetryRecord.started_at, TelemetryRecord.received_at).where(
        *conditions(**scope),
        TelemetryRecord.operation.startswith("asr."),
        TelemetryRecord.outcome.in_(("error", "timeout")),
    )).all()
    replays = [row for row in rows if row.is_replay]
    delays = [(row.received_at - row.started_at).total_seconds() * 1000 for row in replays
              if row.received_at is not None and row.received_at >= row.started_at]
    return {
        "count": len(replays),
        "failed_count": len(rows),
        "unclassified_count": sum(row.is_replay is None for row in rows),
        "delay_samples": len(delays),
        "median_delay_ms": median(delays) if delays else None,
    }

def sample_coverage(oldest: datetime | None, newest: datetime | None) -> dict[str, str | None]:
    return {
        "oldest_at": oldest.isoformat(timespec="milliseconds") + "Z" if oldest is not None else None,
        "newest_at": newest.isoformat(timespec="milliseconds") + "Z" if newest is not None else None,
    }


def overview(db, **filters):
    from app.services.model_pricing import pricing_summary
    source = filters.get("source", "server")
    rows = db.execute(select(TelemetryRecord.duration_ms, TelemetryRecord.ttft_ms,
        TelemetryRecord.outcome, TelemetryRecord.input_tokens, TelemetryRecord.output_tokens,
        TelemetryRecord.started_at, TelemetryRecord.operation, TelemetryRecord.model).where(*conditions(**filters))).all()
    completed = [r for r in rows if r.outcome != "cancelled"]
    known = [r for r in rows if r.input_tokens is not None and r.output_tokens is not None]
    buckets = {}
    for row in rows:
        key = row.started_at.replace(minute=0, second=0, microsecond=0).isoformat() + "Z"
        bucket = buckets.setdefault((key, row.operation), [])
        bucket.append(row)
    facet_filters = conditions(hours=filters.get("hours", 24), source=source,
                               traffic=filters.get("traffic", "all"), test_run_id=filters.get("test_run_id"),
                               delivery=filters.get("delivery", "all"))
    facets = {name: list(db.scalars(select(column).where(*facet_filters, column.is_not(None))
                                  .distinct().order_by(column).limit(100)).all())
              for name, column in (("operations", TelemetryRecord.operation), ("models", TelemetryRecord.model), ("releases", TelemetryRecord.release))}
    result = {"source": source, "count": len(rows), "facets": facets,
        "coverage": sample_coverage(
            min((row.started_at for row in rows), default=None),
            max((row.started_at for row in rows), default=None),
        ),
        "pricing": pricing_summary(rows, source=source),
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
    if source == "browser":
        result["asr_replays"] = _asr_replay_summary(db, **filters)
    return result
