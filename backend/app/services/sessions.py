"""Persistence helpers for practice sessions."""

from __future__ import annotations

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.session import PracticeSession, SkillScore, Turn
from app.schemas.session import SaveSessionRequest

# Keep storage bounded: only retain the most recent N sessions.
SESSION_KEEP = 200


def create_session(db: Session, client_id: str, payload: SaveSessionRequest) -> PracticeSession:
    session = PracticeSession(
        client_id=client_id,
        scenario_id=payload.scenario_id,
        overall=payload.overall,
        summary=payload.summary,
        tip=payload.tip,
        turns=[
            Turn(idx=i, role=m.role, content=m.content)
            for i, m in enumerate(payload.messages)
        ],
        scores=[
            SkillScore(key=s.key, label_en=s.label_en, label_zh=s.label_zh, score=s.score)
            for s in payload.scores
        ],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    prune_sessions(db, client_id)
    return session


def prune_sessions(db: Session, client_id: str, keep: int = SESSION_KEEP) -> None:
    """Delete this client's sessions older than its most recent ``keep`` (cascades)."""
    stale = list(
        db.scalars(
            select(PracticeSession)
            .where(PracticeSession.client_id == client_id)
            .order_by(desc(PracticeSession.created_at))
            .offset(keep)
        )
    )
    if stale:
        for s in stale:
            db.delete(s)
        db.commit()


def list_sessions(db: Session, client_id: str, limit: int = 50) -> list[PracticeSession]:
    stmt = (
        select(PracticeSession)
        .where(PracticeSession.client_id == client_id)
        .order_by(desc(PracticeSession.created_at))
        .limit(limit)
    )
    return list(db.scalars(stmt))


def get_session(db: Session, client_id: str, session_id: int) -> PracticeSession | None:
    return db.scalars(
        select(PracticeSession).where(
            PracticeSession.id == session_id, PracticeSession.client_id == client_id
        )
    ).first()
