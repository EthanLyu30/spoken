"""Remove a history record and retain only the identity needed for retries."""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.practice import PracticeRecord
from app.models.progress import DELETED_PRACTICE_EVENT, DELETED_SESSION_EVENT, LearningEvent
from app.models.session import PracticeSession
from app.services import progress, request_receipts


class HistoryRecordChanged(Exception):
    """The owner has a different record at the same numeric ID."""

    detail = "练习记录已更新，请刷新后再试。"


def matches_created_at(stored: datetime | None, requested: datetime) -> bool:
    if stored is not None and stored.tzinfo is None and requested.tzinfo is not None:
        stored = stored.replace(tzinfo=timezone.utc)
    return stored == requested


def delete_record(db: Session, owner: str, model: type[PracticeSession] | type[PracticeRecord],
                  record_id: int, created_at: datetime) -> bool:
    if model is PracticeSession:
        active_types = ("session",)
        deleted_type = DELETED_SESSION_EVENT
    else:
        active_types = ("practice",)
        deleted_type = DELETED_PRACTICE_EVENT

    try:
        progress.lock_owner(db, owner)
        record = db.scalar(select(model).where(model.client_id == owner, model.id == record_id))
        events = [event for event in db.scalars(select(LearningEvent).where(
            LearningEvent.client_id == owner, LearningEvent.source_id == record_id,
            LearningEvent.event_type.in_((*active_types, deleted_type))))
                  if matches_created_at(event.occurred_at, created_at)]
        if record is None or not matches_created_at(record.created_at, created_at):
            already_deleted = any(event.event_type == deleted_type for event in events)
            if record is not None and not already_deleted:
                raise HistoryRecordChanged
            db.rollback()
            return already_deleted

        if any(event.event_type in ("session", "practice") for event in events):
            progress.preserve_reward_achievements(db, owner)
        if not events:
            # A surviving legacy source may not have had an activity receipt.
            events = [progress.record_event(db, owner, deleted_type, source_id=record_id,
                client_session_id=record.client_session_id if isinstance(record, PracticeSession) else None,
                occurred_at=record.created_at)]
        for event in events:
            if model is PracticeRecord:
                request_receipts.scrub_practice(db, owner, event.event_key)
            event.event_type = deleted_type
            event.scenario_id = event.kind = event.score = event.word_text = None
        db.delete(record)
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
