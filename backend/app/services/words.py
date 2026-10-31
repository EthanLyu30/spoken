"""Word-bag persistence + on-demand definition via DeepSeek."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import asc, desc, select
from sqlalchemy.orm import Session

from app.models.word import WordEntry
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services import progress

# Leitner intervals (days) by box level; remembering bumps the box up.
SRS_INTERVALS_DAYS = [0, 1, 2, 4, 8, 16, 30]

_DEFINE_SYSTEM = """Define an English word or phrase for a Chinese learner. Return ONLY a JSON object: {"meaning": "简短中文释义", "example": "one short, natural English example sentence using it"}."""


async def define_word(text: str, client: DeepSeekClient) -> tuple[str, str]:
    """Best-effort meaning + example. Returns empty strings on failure."""
    messages = [
        {"role": "system", "content": _DEFINE_SYSTEM},
        {"role": "user", "content": f"Word or phrase: {text}"},
    ]
    try:
        raw = await client.chat(
            messages,
            temperature=0.3,
            max_tokens=160,
            response_format={"type": "json_object"},
        )
        data = json.loads(raw)
        return str(data.get("meaning", "")), str(data.get("example", ""))
    except (DeepSeekError, json.JSONDecodeError, TypeError, KeyError):
        return "", ""


def find_by_text(db: Session, client_id: str, text: str) -> WordEntry | None:
    return db.scalars(
        select(WordEntry).where(WordEntry.text == text, WordEntry.client_id == client_id)
    ).first()


def create_word(
    db: Session,
    client_id: str,
    text: str,
    scenario_id: str,
    meaning: str,
    example: str,
    kind: str = "word",
    timezone: str | None = None,
) -> WordEntry:
    progress.lock_owner(db, client_id)
    text = text.strip()
    existing = find_by_text(db, client_id, text)
    if existing is not None:
        db.commit()
        return existing
    entry = WordEntry(
        client_id=client_id,
        text=text,
        scenario_id=scenario_id,
        meaning=meaning,
        example=example,
        kind=kind,
    )
    db.add(entry)
    try:
        db.flush()
        progress.record_event(db, client_id, "word_collected", source_id=entry.id,
                              occurred_at=entry.created_at, word_text=entry.text)
        progress.stats_and_awards(db, client_id, timezone)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(entry)
    return entry


def list_words(db: Session, client_id: str) -> list[WordEntry]:
    return list(
        db.scalars(
            select(WordEntry)
            .where(WordEntry.client_id == client_id)
            .order_by(desc(WordEntry.created_at))
        )
    )


def get_word(db: Session, client_id: str, word_id: int) -> WordEntry | None:
    return db.scalars(
        select(WordEntry).where(WordEntry.id == word_id, WordEntry.client_id == client_id)
    ).first()


def list_due(db: Session, client_id: str, kind: str | None = None) -> list[WordEntry]:
    """Words whose review is due (not yet mastered), soonest first."""
    now = datetime.utcnow()
    stmt = select(WordEntry).where(
        WordEntry.client_id == client_id,
        WordEntry.due_at <= now,
        WordEntry.mastered.is_(False),
    )
    if kind:
        stmt = stmt.where(WordEntry.kind == kind)
    return list(db.scalars(stmt.order_by(asc(WordEntry.due_at))))


def review_word(db: Session, entry: WordEntry, remembered: bool,
                timezone: str | None = None) -> WordEntry:
    """Apply a Leitner review: remembered -> longer interval, forgot -> reset."""
    _lock_entry(db, entry)
    box = entry.box or 0
    box = min(box + 1, len(SRS_INTERVALS_DAYS) - 1) if remembered else 0
    now = datetime.utcnow()
    entry.box = box
    entry.last_reviewed = now
    entry.due_at = now + timedelta(days=SRS_INTERVALS_DAYS[box])
    try:
        db.flush()
        progress.record_event(db, entry.client_id, "word_reviewed", source_id=entry.id,
                              occurred_at=now, word_text=entry.text.strip())
        progress.stats_and_awards(db, entry.client_id, timezone)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(entry)
    return entry


def delete_word(db: Session, entry: WordEntry) -> None:
    _lock_entry(db, entry)
    db.delete(entry)
    db.commit()


def _lock_entry(db: Session, entry: WordEntry) -> None:
    """Revalidate ownership after waiting for a concurrent review or claim."""
    owner, word_id = entry.client_id, entry.id
    progress.lock_owner(db, owner)
    current = db.scalar(select(WordEntry).where(WordEntry.id == word_id, WordEntry.client_id == owner)
                        .execution_options(populate_existing=True))
    if current is None:
        db.rollback()
        raise ValueError("Word no longer belongs to this owner")


def set_mastered(db: Session, entry: WordEntry, mastered: bool) -> WordEntry:
    _lock_entry(db, entry)
    entry.mastered = mastered
    db.commit()
    db.refresh(entry)
    return entry
