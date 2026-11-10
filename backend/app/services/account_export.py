"""Read-only account data export.

``build_account_export`` derives the data owner from the authenticated
:class:`~app.models.user.User` (``u:<id>``, the same namespace used by
:func:`app.core.deps.get_client_id`) and returns a JSON-encodable snapshot of
everything that account owns. Callers must pass a user obtained from a
verified session; the function never reads request headers, so it cannot be
pointed at a guest device id or another account.

Every field is whitelisted. Internal identifiers, guest/device ids,
``guest_claims``, ``request_receipts``, telemetry and credentials
(``password_hash``) are deliberately absent from the payload.

Timestamps are stored as UTC-naive datetimes (see the models) and are
serialised as ISO 8601 with an explicit ``Z``, so the result is
``json.dumps``-safe without FastAPI's encoder.

Queries are fixed in number regardless of row counts: one per list, plus two
batched ``selectinload`` queries for session turns and scores (no N+1).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, LearningEvent
from app.models.session import PracticeSession
from app.models.user import User
from app.models.word import WordEntry

EXPORT_VERSION = 1


def build_account_export(db: Session, user: User) -> dict:
    """Return one account's data as a versioned, JSON-encodable dict.

    The caller owns the session and the authentication check; this function
    only reads and never commits, flushes or mutates the user.
    """
    if user.id is None:
        raise ValueError("build_account_export requires a persisted user")
    owner = f"u:{user.id}"
    return {
        "version": EXPORT_VERSION,
        "profile": _profile(user),
        "sessions": _sessions(db, owner),
        "practice": _practice(db, owner),
        "words": _words(db, owner),
        "learning_events": _learning_events(db, owner),
        "badges": _badges(db, owner),
    }


def _iso(value: datetime | None) -> str | None:
    """UTC-naive database timestamps -> ISO 8601 with an explicit ``Z``."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _profile(user: User) -> dict[str, Any]:
    # password_hash is intentionally never copied out of the account row.
    return {
        "email": user.email,
        "display_name": user.display_name or "",
        "avatar_url": user.avatar_url or "",
        "created_at": _iso(user.created_at),
    }


def _words(db: Session, owner: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(WordEntry)
        .where(WordEntry.client_id == owner)
        .order_by(WordEntry.created_at, WordEntry.id)
    ).all()
    return [
        {
            "id": word.id,
            "text": word.text,
            "meaning": word.meaning or "",
            "example": word.example or "",
            "scenario_id": word.scenario_id or "",
            "kind": word.kind,
            "mastered": bool(word.mastered),
            "created_at": _iso(word.created_at),
            # Spaced-repetition state, mirroring the word-bag API.
            "box": word.box,
            "due_at": _iso(word.due_at),
            "last_reviewed": _iso(word.last_reviewed),
        }
        for word in rows
    ]


def _sessions(db: Session, owner: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PracticeSession)
        .options(
            selectinload(PracticeSession.turns),
            selectinload(PracticeSession.scores),
        )
        .where(PracticeSession.client_id == owner)
        .order_by(PracticeSession.created_at, PracticeSession.id)
    ).all()
    return [
        {
            "id": session.id,
            "scenario_id": session.scenario_id,
            "overall": session.overall,
            "summary": session.summary or "",
            "tip": session.tip or "",
            "created_at": _iso(session.created_at),
            "turns": [
                {"idx": turn.idx, "role": turn.role, "content": turn.content}
                for turn in sorted(session.turns, key=lambda item: item.idx)
            ],
            "scores": [
                {
                    "key": score.key,
                    "label_en": score.label_en,
                    "label_zh": score.label_zh,
                    "score": score.score,
                }
                for score in sorted(session.scores, key=lambda item: item.id)
            ],
        }
        for session in rows
    ]


def _practice(db: Session, owner: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(PracticeRecord)
        .where(PracticeRecord.client_id == owner)
        .order_by(PracticeRecord.created_at, PracticeRecord.id)
    ).all()
    return [
        {
            "id": record.id,
            "kind": record.kind,
            "title": record.title or "",
            "score": record.score,
            # 100 for pronunciation; 5 for the current interview rubric and 6
            # for historical records, exactly as the app renders them.
            "score_max": record.score_max,
            "detail": _practice_detail(record.detail),
            "created_at": _iso(record.created_at),
        }
        for record in rows
    ]


def _practice_detail(raw: str | None) -> object:
    """Keep the stored detail losslessly, as JSON when it is a JSON object.

    Malformed legacy detail is returned verbatim instead of raising, so one bad
    row cannot break the whole export.
    """
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return raw
    return parsed if isinstance(parsed, (dict, list)) else raw


def _learning_events(db: Session, owner: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(LearningEvent)
        .where(LearningEvent.client_id == owner)
        .order_by(LearningEvent.occurred_at, LearningEvent.event_key)
    ).all()
    return [
        {
            "event_type": event.event_type,
            "occurred_at": _iso(event.occurred_at),
            "scenario_id": event.scenario_id,
            "kind": event.kind,
            "score": event.score,
            "word_text": event.word_text,
        }
        for event in rows
    ]


def _badges(db: Session, owner: str) -> list[dict[str, Any]]:
    rows = db.scalars(
        select(EarnedBadge)
        .where(EarnedBadge.client_id == owner)
        .order_by(EarnedBadge.earned_at, EarnedBadge.badge_key)
    ).all()
    return [
        {"key": badge.badge_key, "earned_at": _iso(badge.earned_at)}
        for badge in rows
    ]
