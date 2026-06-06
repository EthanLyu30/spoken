"""Word-bag persistence + on-demand definition via DeepSeek."""

from __future__ import annotations

import json

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.models.word import WordEntry
from app.services.deepseek import DeepSeekClient, DeepSeekError

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


def delete_word(db: Session, entry: WordEntry) -> None:
    db.delete(entry)
    db.commit()
