"""Persistence helpers for practice sessions."""

from __future__ import annotations

from sqlalchemy import case, desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

from app.data.scenarios import SCENARIOS
from app.models.progress import LearningEvent
from app.models.session import PracticeSession, SkillScore, Turn
from app.schemas.session import ExpiredSessionReceipt, SaveSessionRequest, SessionSummary
from app.services import practice, progress
from app.services.corrections import ground_corrections, read_corrections, repeated_focus

# Keep storage bounded: only retain the most recent N sessions.
SESSION_KEEP = 200


def create_session(db: Session, client_id: str, payload: SaveSessionRequest,
                   timezone: str | None = None) -> PracticeSession | ExpiredSessionReceipt:
    def existing() -> PracticeSession | ExpiredSessionReceipt | None:
        if not payload.client_session_id:
            return None
        receipt = db.scalar(select(LearningEvent).where(
            LearningEvent.client_id == client_id,
            LearningEvent.client_session_id == payload.client_session_id,
        ))
        retained = db.scalars(select(PracticeSession).where(
            PracticeSession.client_id == client_id,
            PracticeSession.client_session_id == payload.client_session_id,
        )).first()
        if retained is not None:
            return retained
        if receipt is not None:
            return ExpiredSessionReceipt(id=receipt.source_id, scenario_id=receipt.scenario_id,
                                         overall=int(receipt.score) if receipt.score is not None else None,
                                         created_at=receipt.occurred_at)
        return None

    progress.lock_owner(db, client_id)
    previous = existing()
    if previous is not None:
        if (isinstance(previous, PracticeSession) and not previous.scored and payload.overall is not None
                and previous.scenario_id == payload.scenario_id
                and [(turn.role, turn.content) for turn in previous.turns] ==
                    [(message.role, message.content) for message in payload.messages]):
            previous.overall = payload.overall
            previous.scored = True
            previous.summary = payload.summary
            previous.tip = payload.tip
            previous.scores = [SkillScore(**score.model_dump()) for score in payload.scores]
            marks = [correction for correction in read_corrections(previous.corrections) if correction.marked]
            previous.corrections = [entry.model_dump() for entry in ground_corrections(
                [*payload.corrections, *marks], payload.messages,
            )]
            db.execute(update(LearningEvent).where(
                LearningEvent.client_id == client_id,
                LearningEvent.event_type == "session",
                LearningEvent.source_id == previous.id,
                LearningEvent.client_session_id == previous.client_session_id,
            ).values(score=payload.overall))
            db.flush()
            progress.stats_and_awards(db, client_id, timezone)
        db.commit()  # Release the owner lock on canonical retry reads too.
        return previous
    session = PracticeSession(
        client_id=client_id,
        client_session_id=payload.client_session_id,
        scenario_id=payload.scenario_id,
        # Historical schemas require an integer. Unscored rows expose NULL via
        # reported_score and store NULL in the permanent learning receipt.
        overall=payload.overall if payload.overall is not None else 0,
        scored=payload.overall is not None,
        summary=payload.summary,
        tip=payload.tip,
        corrections=[entry.model_dump() for entry in ground_corrections(payload.corrections, payload.messages)],
        custom=payload.custom.model_dump(exclude_none=True) if payload.scenario_id == "custom" and payload.custom is not None else None,
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
    try:
        db.flush()
        progress.record_event(db, client_id, "session", source_id=session.id,
                              client_session_id=session.client_session_id,
                              occurred_at=session.created_at, scenario_id=session.scenario_id,
                              score=session.reported_score)
        progress.stats_and_awards(db, client_id, timezone)
        db.commit()
    except IntegrityError:
        # Concurrent report/navigation retries may reach different workers.
        db.rollback()
        previous = existing()
        if previous is None:
            raise
        return previous
    except Exception:
        db.rollback()
        raise
    prune_sessions(db, client_id)
    return session


def prune_sessions(db: Session, client_id: str, keep: int = SESSION_KEEP) -> None:
    """Delete this client's sessions older than its most recent ``keep`` (cascades)."""
    stale = list(
        db.scalars(
            select(PracticeSession)
            .options(load_only(PracticeSession.id))
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


def progress_sessions(db: Session, client_id: str) -> dict:
    """Read recent session metadata and correction tags without loading messages."""
    rows = db.execute(
        select(PracticeSession.id, PracticeSession.scenario_id,
               case((PracticeSession.scored, PracticeSession.overall)).label("overall"),
               PracticeSession.created_at, PracticeSession.corrections)
        .where(PracticeSession.client_id == client_id)
        .order_by(desc(PracticeSession.created_at), desc(PracticeSession.id)).limit(50)).all()
    summaries = [SessionSummary.model_validate(row) for row in rows]
    recent = [session for session in summaries if session.overall is not None][:practice.INSIGHTS_RECENT]
    by_session = {session.id: [] for session in recent}
    if recent:
        scores = db.execute(select(SkillScore.session_id, SkillScore.key, SkillScore.label_en,
                                   SkillScore.label_zh, SkillScore.score)
            .join(PracticeSession, PracticeSession.id == SkillScore.session_id)
            .where(PracticeSession.client_id == client_id, SkillScore.session_id.in_(by_session)))
        for score in scores:
            by_session[score.session_id].append(score)
    return {"sessions": summaries,
            "insights": practice.insights_from_scores(list(by_session.values())),
            "correction_focus": repeated_focus(
                ((row.scenario_id, row.corrections) for row in rows), {scene.id for scene in SCENARIOS},
            ),
            "latest": {"id": recent[0].id,
                       "scores": [dict(score._mapping) for score in by_session[recent[0].id]]}
                      if recent else None}
