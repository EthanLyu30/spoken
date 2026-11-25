"""Persistence helpers for practice sessions."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import and_, case, desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, load_only, selectinload

from app.data.scenarios import SCENARIOS
from app.models.progress import DELETED_SESSION_EVENT, LearningEvent
from app.models.session import PracticeSession, SkillScore, Turn
from app.schemas.chat import ChatMessage
from app.schemas.feedback import Correction
from app.schemas.session import CorrectionPracticeSelection, ExpiredSessionReceipt, SaveSessionRequest, SessionSummary
from app.services import practice, progress
from app.services.corrections import (
    ground_corrections, merge_scored_corrections, merge_sentence_favorites, read_corrections, repeated_focus,
)
from app.services.history_deletion import HistoryRecordChanged, matches_created_at
from app.services.request_receipts import DeletedPracticeRecord

# Keep storage bounded: only retain the most recent N sessions.
SESSION_KEEP = 200


class CorrectionSelectionConflict(ValueError):
    pass


def create_session(db: Session, client_id: str, payload: SaveSessionRequest,
                   timezone: str | None = None) -> PracticeSession | ExpiredSessionReceipt:
    def existing() -> PracticeSession | ExpiredSessionReceipt | None:
        if not payload.client_session_id:
            return None
        receipt = db.scalar(select(LearningEvent).where(
            LearningEvent.client_id == client_id,
            LearningEvent.client_session_id == payload.client_session_id,
        ))
        if receipt is not None and receipt.event_type == DELETED_SESSION_EVENT:
            raise DeletedPracticeRecord
        # Materialize the retry response while the caller holds the owner lock.
        retained = db.scalars(select(PracticeSession)
            .where(PracticeSession.client_id == client_id,
                   PracticeSession.client_session_id == payload.client_session_id)
            .options(selectinload(PracticeSession.turns), selectinload(PracticeSession.scores))).first()
        if retained is not None:
            return retained
        if receipt is not None:
            return ExpiredSessionReceipt(id=receipt.source_id, scenario_id=receipt.scenario_id,
                                         overall=int(receipt.score) if receipt.score is not None else None,
                                         created_at=receipt.occurred_at)
        return None

    def update_retry(previous: PracticeSession | ExpiredSessionReceipt) -> None:
        if (not isinstance(previous, PracticeSession) or previous.scenario_id != payload.scenario_id
                or [(turn.role, turn.content) for turn in previous.turns] !=
                   [(message.role, message.content) for message in payload.messages]):
            return
        if not previous.scored and payload.overall is not None:
            previous.overall = payload.overall
            previous.scored = True
            previous.summary = payload.summary
            previous.tip = payload.tip
            previous.scores = [SkillScore(**score.model_dump()) for score in payload.scores]
            previous.corrections = [entry.model_dump() for entry in merge_scored_corrections(
                payload.corrections, read_corrections(previous.corrections), payload.messages,
            )]
            db.execute(update(LearningEvent).where(
                LearningEvent.client_id == client_id,
                LearningEvent.event_type == "session",
                LearningEvent.source_id == previous.id,
                LearningEvent.client_session_id == previous.client_session_id,
            ).values(score=payload.overall))
            db.flush()
            progress.stats_and_awards(db, client_id, timezone)
        elif payload.corrections:
            # Whole-sentence favorites can be confirmed after a stop checkpoint. A
            # retry may add them, while correction selections and the grade stay canonical.
            merged = merge_sentence_favorites(payload.corrections, previous.corrections, payload.messages)
            if merged != previous.corrections:
                previous.corrections = merged

    try:
        progress.lock_owner(db, client_id)
        previous = existing()
        if previous is not None:
            update_retry(previous)
            db.commit()  # Release the owner lock on canonical retry reads too.
            return previous
    except Exception:
        db.rollback()
        raise
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
        _prune_sessions(db, client_id, SESSION_KEEP)
        db.commit()
    except IntegrityError:
        # Concurrent report/navigation retries may reach different workers.
        db.rollback()
        try:
            progress.lock_owner(db, client_id)
            previous = existing()
            if previous is None:
                raise
            update_retry(previous)
            db.commit()
        except Exception:
            db.rollback()
            raise
        return previous
    except Exception:
        db.rollback()
        raise
    return session


def prune_sessions(db: Session, client_id: str, keep: int = SESSION_KEEP) -> None:
    """Delete this client's sessions older than its most recent ``keep`` (cascades)."""
    progress.lock_owner(db, client_id)
    _prune_sessions(db, client_id, keep)
    db.commit()


def _prune_sessions(db: Session, client_id: str, keep: int) -> None:
    stale = list(
        db.scalars(
            select(PracticeSession)
            .options(load_only(PracticeSession.id))
            .where(PracticeSession.client_id == client_id)
            .order_by(desc(PracticeSession.created_at))
            .offset(keep)
        )
    )
    for session in stale:
        db.delete(session)


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


def get_session_detail(db: Session, client_id: str, session_id: int,
                       created_at: datetime | None = None) -> PracticeSession | None:
    # Read parent, turns and scores in one owner-scoped SQL snapshot. A later
    # relationship read using only the numeric ID could see a replacement row.
    statement = (select(PracticeSession)
        .where(PracticeSession.id == session_id, PracticeSession.client_id == client_id)
        .options(joinedload(PracticeSession.turns), joinedload(PracticeSession.scores)))
    if created_at is not None:
        if created_at.tzinfo is not None:
            try:
                created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
            except OverflowError:
                return None  # The provided offset takes this time outside the database timestamp range.
        statement = statement.where(PracticeSession.created_at == created_at)
    return db.scalars(statement).unique().one_or_none()


def select_correction(db: Session, client_id: str, session_id: int,
                      selection: CorrectionPracticeSelection) -> list[Correction] | None:
    progress.lock_owner(db, client_id)
    session = get_session(db, client_id, session_id)
    if session is None:
        db.rollback()
        return None
    if not matches_created_at(session.created_at, selection.created_at):
        db.rollback()
        raise CorrectionSelectionConflict(HistoryRecordChanged.detail)
    stored = list(session.corrections) if isinstance(session.corrections, list) else []
    identity = selection.model_dump(include={"original", "suggestion", "category"})
    matching = []
    for position, raw in enumerate(stored):
        entries = read_corrections([raw])
        if entries and not entries[0].self_marked and entries[0].model_dump(include=identity.keys()) == identity:
            matching.append((position, entries[0]))
    # A uniquely matched legacy fragment acquires its turn on first selection.
    # The resolved turn is also the identity used by a retry of that request.
    matching.sort(key=lambda item: item[1].turn_index != selection.turn_index)
    for position, fix in matching:
        index = selection.turn_index
        if fix.turn_index != index and (not selection.marked or fix.turn_index is not None):
            continue
        if selection.marked:
            messages = [ChatMessage(role=turn.role, content=turn.content) for turn in session.turns]
            indexes = [fix.turn_index] if fix.turn_index is not None else range(len(messages))
            matches = [i for i in indexes if ground_corrections([fix.model_copy(update={"turn_index": i})], messages)]
            if index is None or matches != [index]:
                raise CorrectionSelectionConflict("这条建议无法定位到唯一的原句。")
        if fix.marked != selection.marked or fix.turn_index != index:
            stored[position] = {**stored[position], "marked": selection.marked, "turn_index": index}
            session.corrections = stored
        db.commit()
        return read_corrections(stored, session_id)
    raise CorrectionSelectionConflict("这条纠错已更新，请刷新记录后再试。")


def progress_sessions(db: Session, client_id: str) -> dict:
    """Read history and recent skill scores in one snapshot without loading turns."""
    history = (select(PracticeSession.id, PracticeSession.scenario_id,
                      case((PracticeSession.scored, PracticeSession.overall)).label("overall"),
                      PracticeSession.created_at, PracticeSession.corrections)
        .where(PracticeSession.client_id == client_id)
        .order_by(desc(PracticeSession.created_at), desc(PracticeSession.id)).limit(50).cte("recent_sessions"))
    newest_first = (history.c.created_at.desc(), history.c.id.desc())
    recent_ids = (select(history.c.id).where(history.c.overall.is_not(None))
        .order_by(*newest_first).limit(practice.INSIGHTS_RECENT))
    rows = db.execute(select(history, SkillScore.session_id, SkillScore.key, SkillScore.label_en,
                             SkillScore.label_zh, SkillScore.score)
        .outerjoin(SkillScore, and_(SkillScore.session_id == history.c.id, history.c.id.in_(recent_ids)))
        .order_by(*newest_first, SkillScore.id)).all()
    history_rows = {row.id: row for row in rows}
    summaries = [SessionSummary.model_validate(row) for row in history_rows.values()]
    recent = [session for session in summaries if session.overall is not None][:practice.INSIGHTS_RECENT]
    by_session = {session.id: [] for session in recent}
    for row in rows:
        if row.session_id is not None:
            by_session[row.id].append(row)
    return {"sessions": summaries,
            "insights": practice.insights_from_scores(list(by_session.values())),
            "correction_focus": repeated_focus(
                ((row.scenario_id, row.corrections) for row in history_rows.values()), {scene.id for scene in SCENARIOS},
            ),
            "latest": {"id": recent[0].id,
                       "scores": [{"key": row.key, "label_zh": row.label_zh, "label_en": row.label_en, "score": row.score}
                                  for row in by_session[recent[0].id]]}
                      if recent else None}
