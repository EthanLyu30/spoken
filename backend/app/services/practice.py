"""Persistence + aggregation for practice records and learner stats."""

from __future__ import annotations

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session, selectinload

from app.models.practice import PracticeRecord
from app.models.session import PracticeSession
from app.schemas.practice import PracticeCreate
from app.services import progress

TODAY_GOAL = 3
XP_PER_LEVEL = 250
# Keep storage bounded: only retain the most recent N practice records.
PRACTICE_KEEP = 1000
# How many recent sessions feed the cross-session ability analysis.
INSIGHTS_RECENT = 8


def create_record(db: Session, client_id: str, payload: PracticeCreate,
                  timezone: str | None = None) -> PracticeRecord:
    progress.lock_owner(db, client_id)
    record = PracticeRecord(
        client_id=client_id,
        kind=payload.kind,
        score=payload.score,
        title=payload.title,
        detail=payload.detail,
    )
    db.add(record)
    try:
        db.flush()
        progress.record_event(db, client_id, "practice", source_id=record.id,
                              occurred_at=record.created_at, kind=record.kind, score=record.score)
        progress.stats_and_awards(db, client_id, timezone)
        db.commit()
    except Exception:
        db.rollback()
        raise
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


def compute_stats(db: Session, client_id: str, timezone: str | None = None) -> dict:
    try:
        has_events = db.scalar(select(progress.LearningEvent.event_key)
                               .where(progress.LearningEvent.client_id == client_id).limit(1))
        if has_events:
            progress.lock_owner(db, client_id)
        # An empty snapshot cannot earn any badges. Keep first-visit reads free
        # of writes and mutex rows; a racing activity writer owns its awards.
        result = progress.stats_and_awards(db, client_id, timezone, events=None if has_events else [])
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def compute_insights(db: Session, client_id: str, recent: int = INSIGHTS_RECENT) -> dict:
    """Aggregate the learner's recent sessions into per-skill averages and a
    short-term trend, so the UI can point at the weakest dimension to focus on
    and show whether things are improving.

    The trend (``delta``) compares the later half of each skill's recent score
    series against its earlier half: positive means the learner is climbing.
    """
    sessions = list(
        db.scalars(
            select(PracticeSession)
            .options(selectinload(PracticeSession.scores))
            .where(PracticeSession.client_id == client_id)
            .order_by(desc(PracticeSession.created_at))
            .limit(recent)
        )
    )
    sessions.reverse()  # oldest -> newest, so the trend reads left to right

    series: dict[str, dict] = {}
    for s in sessions:
        for sc in s.scores:
            entry = series.setdefault(
                sc.key,
                {"label_zh": sc.label_zh, "label_en": sc.label_en, "scores": []},
            )
            entry["scores"].append(sc.score)

    if not series:
        return {
            "available": False,
            "sessions": len(sessions),
            "overall_delta": 0,
            "weakest": None,
            "strongest": None,
            "skills": [],
        }

    skills: list[dict] = []
    for key, entry in series.items():
        scores = entry["scores"]
        avg = round(sum(scores) / len(scores))
        if len(scores) >= 2:
            half = len(scores) // 2
            earlier, later = scores[:half], scores[half:]
            delta = round(sum(later) / len(later) - sum(earlier) / len(earlier))
        else:
            delta = 0
        skills.append(
            {
                "key": key,
                "label_zh": entry["label_zh"],
                "label_en": entry["label_en"],
                "avg": avg,
                "delta": delta,
                "samples": len(scores),
            }
        )

    skills.sort(key=lambda x: x["avg"])  # weakest first
    overall_delta = round(sum(x["delta"] for x in skills) / len(skills))
    return {
        "available": True,
        "sessions": len(sessions),
        "overall_delta": overall_delta,
        "weakest": skills[0],
        "strongest": skills[-1],
        "skills": skills,
    }
