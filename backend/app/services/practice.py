"""Persistence + aggregation for practice records and learner stats."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import delete, desc, func, select
from sqlalchemy.orm import Session

from app.models.practice import PracticeRecord
from app.models.session import PracticeSession
from app.models.word import WordEntry
from app.schemas.practice import PracticeCreate

TODAY_GOAL = 3
XP_PER_LEVEL = 250
# Keep storage bounded: only retain the most recent N practice records.
PRACTICE_KEEP = 1000


def create_record(db: Session, client_id: str, payload: PracticeCreate) -> PracticeRecord:
    record = PracticeRecord(
        client_id=client_id,
        kind=payload.kind,
        score=payload.score,
        title=payload.title,
        detail=payload.detail,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    prune_records(db, client_id)
    return record


def prune_records(db: Session, client_id: str, keep: int = PRACTICE_KEEP) -> None:
    """Delete this client's practice records older than its most recent ``keep``."""
    stale_ids = list(
        db.scalars(
            select(PracticeRecord.id)
            .where(PracticeRecord.client_id == client_id)
            .order_by(desc(PracticeRecord.created_at))
            .offset(keep)
        )
    )
    if stale_ids:
        db.execute(delete(PracticeRecord).where(PracticeRecord.id.in_(stale_ids)))
        db.commit()


def list_records(
    db: Session, client_id: str, kind: str | None = None, limit: int = 100
) -> list[PracticeRecord]:
    stmt = select(PracticeRecord).where(PracticeRecord.client_id == client_id)
    if kind:
        stmt = stmt.where(PracticeRecord.kind == kind)
    stmt = stmt.order_by(desc(PracticeRecord.created_at)).limit(limit)
    return list(db.scalars(stmt))


def _local_dates(dts: list[datetime], offset: timedelta) -> list[date]:
    return [(dt + offset).date() for dt in dts if dt is not None]


def compute_stats(db: Session, client_id: str) -> dict:
    # created_at is stored as naive UTC; shift to local for day grouping.
    offset = datetime.now() - datetime.utcnow()
    today = (datetime.utcnow() + offset).date()

    all_dts: list[datetime] = []
    all_dts += list(db.scalars(select(PracticeSession.created_at).where(PracticeSession.client_id == client_id)))
    all_dts += list(db.scalars(select(PracticeRecord.created_at).where(PracticeRecord.client_id == client_id)))
    all_dts += list(db.scalars(select(WordEntry.created_at).where(WordEntry.client_id == client_id)))
    local = _local_dates(all_dts, offset)
    days = set(local)

    # Streak: consecutive days up to today (or yesterday if nothing yet today).
    streak = 0
    cursor = today if today in days else today - timedelta(days=1)
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)

    today_count = sum(1 for d in local if d == today)

    total_sessions = db.scalar(
        select(func.count(PracticeSession.id)).where(PracticeSession.client_id == client_id)
    ) or 0
    total_practice = db.scalar(
        select(func.count(PracticeRecord.id)).where(PracticeRecord.client_id == client_id)
    ) or 0
    words_count = db.scalar(
        select(func.count(WordEntry.id)).where(WordEntry.client_id == client_id)
    ) or 0

    xp_total = total_sessions * 40 + total_practice * 15 + words_count * 5
    level = 1 + xp_total // XP_PER_LEVEL
    xp = xp_total % XP_PER_LEVEL

    return {
        "streak_days": streak,
        "today_count": today_count,
        "today_goal": TODAY_GOAL,
        "level": level,
        "xp": xp,
        "xp_to_next": XP_PER_LEVEL,
        "total_sessions": total_sessions,
        "total_practice": total_practice,
        "words_count": words_count,
    }
