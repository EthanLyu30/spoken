"""Durable progress, transactional awards, and one-time surviving-data import.

All activity writers take the same owner lock before changing source rows. This
serializes badge thresholds/receipts across workers without read-modify-write
counters. Helpers never commit: the caller owns the activity transaction.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import islice
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from app.core.performance import measure
from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, LearningEvent, ProgressMigration, ProgressOwner
from app.models.session import PracticeSession
from app.models.word import WordEntry


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def timezone_name(value: str | None) -> str:
    try:
        return ZoneInfo(value or "UTC").key
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return "UTC"


def _insert(db: Session, model, values: dict) -> None:
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    db.execute(insert(model).values(**values).on_conflict_do_nothing())


def _insert_many(db: Session, model, rows) -> None:
    """Real multirow SQL, bounded below SQLite's historical 999-bind limit.

    Passing rows to execute() would use executemany, which can still issue one
    server operation per row. VALUES batches bound both memory and round trips.
    """
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    batch_size = 900 // len(model.__table__.columns)
    rows = iter(rows)
    while batch := list(islice(rows, batch_size)):
        db.execute(insert(model).values(batch).on_conflict_do_nothing())


def lock_owner(db: Session, client_id: str) -> None:
    # Conflict UPDATE takes the same row/writer lock as an ordinary UPDATE,
    # including when the owner already exists, in a single round trip.
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    db.execute(insert(ProgressOwner).values(client_id=client_id).on_conflict_do_update(
        index_elements=[ProgressOwner.client_id], set_={"client_id": client_id}))


@dataclass(frozen=True)
class ProgressSnapshot:
    has_events: bool
    badges: frozenset[str]
    words_count: int


def read_snapshot(db: Session, client_id: str, *, include_events: bool = False) -> ProgressSnapshot:
    """One portable read, including for owners without any permanent badges.

    The scalar seed always returns one row; its outer join yields every badge
    without JSON aggregation or a separate vocabulary count round trip.
    """
    has_events = (select(LearningEvent.event_key).where(LearningEvent.client_id == client_id).exists()
                  if include_events else literal(False))
    seed = select(has_events.label("has_events"),
        select(func.count(WordEntry.id)).where(WordEntry.client_id == client_id)
        .scalar_subquery().label("words_count")).subquery()
    rows = db.execute(select(seed.c.has_events, seed.c.words_count, EarnedBadge.badge_key)
        .select_from(seed.outerjoin(EarnedBadge, EarnedBadge.client_id == client_id))).all()
    return ProgressSnapshot(bool(rows[0].has_events),
        frozenset(row.badge_key for row in rows if row.badge_key is not None), rows[0].words_count)


def record_event(db: Session, client_id: str, event_type: str, **metadata) -> LearningEvent:
    event = LearningEvent(event_key=str(uuid4()), client_id=client_id,
                          event_type=event_type, **metadata)
    db.add(event)
    db.flush()
    return event


def _local_date(timestamp: datetime, zone: ZoneInfo):
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(zone).date()


def stats_and_awards(db: Session, client_id: str, timezone_value: str | None = None,
                     *, events: list[LearningEvent] | None = None,
                     snapshot: ProgressSnapshot | None = None) -> dict:
    """Compute from the journal and persist newly proven badges without committing."""
    zone_name = timezone_name(timezone_value)
    zone = ZoneInfo(zone_name)
    today = _local_date(utcnow(), zone)
    if events is None:
        events = list(db.scalars(select(LearningEvent).where(LearningEvent.client_id == client_id)))
    with measure("stats_cpu", cpu=True):
        conversations = [e for e in events if e.event_type == "session"]
        practices = [e for e in events if e.event_type == "practice"]
        collected = {e.word_text for e in events if e.event_type == "word_collected" and e.word_text is not None}
        reviewed = {e.word_text for e in events if e.event_type == "word_reviewed" and e.word_text is not None}
        days = {_local_date(e.occurred_at, zone) for e in events if e.occurred_at is not None}
        streak = 0
        cursor = today if today in days else today - timedelta(days=1)
        while cursor in days:
            streak += 1
            cursor -= timedelta(days=1)
        longest = run = 0
        previous = None
        for day in sorted(days):
            run = run + 1 if previous is not None and day == previous + timedelta(days=1) else 1
            longest = max(longest, run)
            previous = day
        xp_total = len(conversations) * 40 + len(practices) * 15 + len(collected) * 5
        level = 1 + xp_total // 250
        achievements = {
            "first_conversation": len(conversations) >= 1,
            "streak_3": longest >= 3,
            "streak_7": longest >= 7,
            "conversations_10": len(conversations) >= 10,
            "words_10": len(collected) >= 10,
            "words_50": len(collected) >= 50,
            "reviewed_words_10": len(reviewed) >= 10,
            "pronunciation_90": any(e.kind == "pronunciation" and (e.score or 0) >= 90 for e in practices),
            "interviews_3": sum(e.kind == "interview" for e in practices) >= 3,
            "conversation_90": any((e.score or 0) >= 90 for e in conversations),
            "scenarios_5": len({e.scenario_id for e in conversations if e.scenario_id}) >= 5,
            "level_3": level >= 3,
        }
    if snapshot is None:
        snapshot = read_snapshot(db, client_id)
    badges = snapshot.badges
    newly_earned = {key for key, earned in achievements.items() if earned} - badges
    _insert_many(db, EarnedBadge, ({"client_id": client_id, "badge_key": key, "earned_at": utcnow()}
                                 for key in sorted(newly_earned)))
    return {
        "streak_days": streak,
        "today_count": sum(e.occurred_at is not None and _local_date(e.occurred_at, zone) == today
                           for e in conversations + practices),
        "today_goal": 3,
        "level": level,
        "xp": xp_total % 250,
        "xp_to_next": 250,
        "total_sessions": len(conversations),
        "total_practice": len(practices),
        "words_count": snapshot.words_count,
        "earned_badges": sorted(badges | newly_earned),
        "timezone": zone_name,
        "local_date": today.isoformat(),
    }


def _legacy_events(db: Session):
    # Every row has the same nullable column shape, including batches crossing
    # source types. Unknown legacy dates stay NULL; source text is never loaded.
    empty = {column.name: None for column in LearningEvent.__table__.columns}
    for row in db.execute(select(PracticeSession.id, PracticeSession.client_id,
            PracticeSession.client_session_id, PracticeSession.created_at,
            PracticeSession.scenario_id, PracticeSession.overall).execution_options(yield_per=90)):
        yield empty | dict(event_key=f"legacy:session:{row.id}", client_id=row.client_id,
            event_type="session", source_id=row.id, client_session_id=row.client_session_id,
            occurred_at=row.created_at, scenario_id=row.scenario_id, score=row.overall)
    for row in db.execute(select(PracticeRecord.id, PracticeRecord.client_id,
            PracticeRecord.created_at, PracticeRecord.kind, PracticeRecord.score).execution_options(yield_per=90)):
        yield empty | dict(event_key=f"legacy:practice:{row.id}", client_id=row.client_id,
            event_type="practice", source_id=row.id, occurred_at=row.created_at,
            kind=row.kind, score=row.score)
    for row in db.execute(select(WordEntry.id, WordEntry.client_id, WordEntry.created_at,
            WordEntry.text, WordEntry.last_reviewed, WordEntry.box).execution_options(yield_per=90)):
        yield empty | dict(event_key=f"legacy:word:{row.id}", client_id=row.client_id,
            event_type="word_collected", source_id=row.id, occurred_at=row.created_at,
            word_text=row.text.strip())
        if row.last_reviewed is not None or (row.box or 0) > 0:
            yield empty | dict(event_key=f"legacy:review:{row.id}", client_id=row.client_id,
                event_type="word_reviewed", source_id=row.id, occurred_at=row.last_reviewed,
                word_text=row.text.strip())


def _backfill_connection(conn: Connection) -> None:
    # The caller's transaction encompasses the lock, imports, awards and marker.
    if conn.dialect.name == "postgresql":
        conn.exec_driver_sql("SELECT pg_advisory_xact_lock(783461902)")
    with Session(bind=conn) as db:
        # A reserved mutex also serializes concurrent migrations on SQLite.
        lock_owner(db, "__progress_migration_v1__")
        if db.get(ProgressMigration, 1) is not None:
            return
        _insert_many(db, LearningEvent, _legacy_events(db))
        for owner in db.scalars(select(LearningEvent.client_id).distinct()):
            stats_and_awards(db, owner)
        db.add(ProgressMigration(version=1))
        db.flush()


def backfill_progress(bind: Engine | Connection) -> None:
    """Import surviving rows exactly once, using only the supplied connection.

    A Connection caller owns its existing transaction. An Engine caller gets one
    atomic transaction here; a failed import leaves neither events nor a marker.
    """
    if isinstance(bind, Engine):
        with bind.begin() as conn:
            _backfill_connection(conn)
    else:
        _backfill_connection(bind)


def claim_progress(db: Session, device_id: str, owner_id: str) -> None:
    """Merge receipts/badges inside the caller's locked claim transaction.

    When both owners have the same client session key, the account's receipt is
    canonical. Discard the redundant guest source and event before owner rewrite.
    """
    account_keys = set(db.scalars(select(LearningEvent.client_session_id).where(
        LearningEvent.client_id == owner_id, LearningEvent.client_session_id.is_not(None))))
    duplicates = list(db.scalars(select(LearningEvent).where(
        LearningEvent.client_id == device_id, LearningEvent.client_session_id.in_(account_keys))))
    for event in duplicates:
        source = db.scalar(select(PracticeSession).where(
            PracticeSession.client_id == device_id,
            PracticeSession.client_session_id == event.client_session_id))
        if source is not None:
            db.delete(source)
        db.delete(event)
    db.flush()
    db.execute(update(LearningEvent).where(LearningEvent.client_id == device_id).values(client_id=owner_id))
    for badge in db.scalars(select(EarnedBadge).where(EarnedBadge.client_id == device_id)):
        _insert(db, EarnedBadge, {"client_id": owner_id, "badge_key": badge.badge_key,
                                 "earned_at": badge.earned_at})
    db.execute(delete(EarnedBadge).where(EarnedBadge.client_id == device_id))
