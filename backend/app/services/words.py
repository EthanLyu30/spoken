"""Word-bag persistence + on-demand definition via DeepSeek."""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import asc, desc, select
from sqlalchemy.orm import Session

from app.models.word import WordEntry
from app.services.deepseek import DeepSeekClient, DeepSeekError

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


def find_by_text(db: Session, text: str) -> WordEntry | None:
    return db.scalars(select(WordEntry).where(WordEntry.text == text)).first()


def create_word(
    db: Session,
    text: str,
    scenario_id: str,
    meaning: str,
    example: str,
    kind: str = "word",
) -> WordEntry:
    entry = WordEntry(
        text=text,
        scenario_id=scenario_id,
        meaning=meaning,
        example=example,
        kind=kind,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_words(db: Session) -> list[WordEntry]:
    return list(db.scalars(select(WordEntry).order_by(desc(WordEntry.created_at))))


def get_word(db: Session, word_id: int) -> WordEntry | None:
    return db.get(WordEntry, word_id)


def list_due(db: Session, kind: str | None = None) -> list[WordEntry]:
    """Words whose review is due (not yet mastered), soonest first."""
    now = datetime.utcnow()
    stmt = select(WordEntry).where(
        WordEntry.due_at <= now, WordEntry.mastered.is_(False)
    )
    if kind:
        stmt = stmt.where(WordEntry.kind == kind)
    return list(db.scalars(stmt.order_by(asc(WordEntry.due_at))))


def review_word(db: Session, entry: WordEntry, remembered: bool) -> WordEntry:
    """Apply a Leitner review: remembered -> longer interval, forgot -> reset."""
    box = entry.box or 0
    box = min(box + 1, len(SRS_INTERVALS_DAYS) - 1) if remembered else 0
    now = datetime.utcnow()
    entry.box = box
    entry.last_reviewed = now
    entry.due_at = now + timedelta(days=SRS_INTERVALS_DAYS[box])
    db.commit()
    db.refresh(entry)
    return entry


def delete_word(db: Session, entry: WordEntry) -> None:
    db.delete(entry)
    db.commit()
