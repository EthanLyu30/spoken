"""Persistence + aggregation for practice records and learner stats."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models.practice import PracticeRecord
from app.models.session import PracticeSession
from app.models.word import WordEntry
from app.schemas.practice import PracticeCreate

TODAY_GOAL = 3
XP_PER_LEVEL = 250


def create_record(db: Session, payload: PracticeCreate) -> PracticeRecord:
    record = PracticeRecord(
        kind=payload.kind,
        score=payload.score,
        title=payload.title,
        detail=payload.detail,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def list_records(db: Session, kind: str | None = None, limit: int = 100) -> list[PracticeRecord]:
    stmt = select(PracticeRecord)
    if kind:
        stmt = stmt.where(PracticeRecord.kind == kind)
    stmt = stmt.order_by(desc(PracticeRecord.created_at)).limit(limit)
    return list(db.scalars(stmt))


def _local_dates(dts: list[datetime], offset: timedelta) -> list[date]:
    return [(dt + offset).date() for dt in dts if dt is not None]


def compute_stats(db: Session) -> dict:
    # created_at is stored as naive UTC; shift to local for day grouping.
    offset = datetime.now() - datetime.utcnow()
    today = (datetime.utcnow() + offset).date()

    all_dts: list[datetime] = []
    all_dts += list(db.scalars(select(PracticeSession.created_at)))
    all_dts += list(db.scalars(select(PracticeRecord.created_at)))
    all_dts += list(db.scalars(select(WordEntry.created_at)))
    local = _local_dates(all_dts, offset)
    days = set(local)

    # Streak: consecutive days up to today (or yesterday if nothing yet today).
    streak = 0
    cursor = today if today in days else today - timedelta(days=1)
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)

    today_count = sum(1 for d in local if d == today)

    total_sessions = db.scalar(select(func.count(PracticeSession.id))) or 0
    total_practice = db.scalar(select(func.count(PracticeRecord.id))) or 0
    words_count = db.scalar(select(func.count(WordEntry.id))) or 0

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
