"""Server-only, source-aligned summaries of reviewed video answer ideas."""

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.data.interview_questions import (
    INSPIRE_PLAYLIST_URL,
    InterviewSet,
    _reviewed_date,
    _text,
    get_interview_sets,
)

ANSWER_REFERENCE_PATH = Path(__file__).with_name("inspire_answer_references.json")


@dataclass(frozen=True)
class AnswerIdea:
    question_index: int
    notes: str
    timestamp: str


@dataclass(frozen=True)
class AnswerReference:
    set_id: str
    episode: int
    source_url: str
    status: Literal["reviewed", "not_provided", "unavailable"]
    answers: tuple[AnswerIdea, ...]
    reason: str = ""


def load_answer_references(
    path: Path | None = None, *, sets: tuple[InterviewSet, ...] | None = None,
) -> dict[str, AnswerReference]:
    """Reject incomplete inventories or notes attached to another source."""
    document = json.loads((ANSWER_REFERENCE_PATH if path is None else path).read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("playlist_url") != INSPIRE_PLAYLIST_URL:
        raise ValueError("Answer references must identify the reviewed Inspire playlist")
    _reviewed_date(document.get("reviewed_at"), "reviewed_at")
    bank = {group.id: group for group in (get_interview_sets() if sets is None else sets) if group.collection == "inspire"}
    rows = document.get("sets")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Answer reference sets must be a nonempty list")
    references = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each answer reference must be an object")
        identifier = _text(row.get("set_id"), "set_id")
        group = bank.get(identifier)
        if group is None or identifier in references:
            raise ValueError("Answer reference set_id is unknown or duplicated")
        if type(row.get("episode")) is not int or row["episode"] != group.episode or row.get("source_url") != group.source_url:
            raise ValueError("Answer reference episode/source_url does not match the question bank")
        status = row.get("status")
        answers = row.get("answers")
        if status not in {"reviewed", "not_provided", "unavailable"} or not isinstance(answers, list):
            raise ValueError("Answer reference status/answers is invalid")
        ideas = []
        reason = ""
        if status == "reviewed":
            if len(answers) != 4:
                raise ValueError("Reviewed references require four ordered answers")
            for index, answer in enumerate(answers, 1):
                if not isinstance(answer, dict) or type(answer.get("question_index")) is not int or answer["question_index"] != index:
                    raise ValueError("Answer reference question_index must be ordered 1–4")
                notes = _text(answer.get("notes"), "notes")
                timestamp = _text(answer.get("timestamp"), "timestamp")
                if not re.fullmatch(r"(?:\d+:)?\d{1,2}:[0-5]\d", timestamp):
                    raise ValueError("Answer reference timestamp must be MM:SS or HH:MM:SS")
                if timestamp.count(":") == 2 and int(timestamp.split(":")[1]) > 59:
                    raise ValueError("Answer reference timestamp minutes are invalid")
                ideas.append(AnswerIdea(index, notes, timestamp))
        else:
            if answers:
                raise ValueError("Unreviewed sources cannot contain answer ideas")
            reason = _text(row.get("reason"), "reason")
        references[identifier] = AnswerReference(identifier, group.episode, group.source_url, status, tuple(ideas), reason)
    if set(references) != set(bank):
        raise ValueError("Answer references must account for every Inspire question set")
    return references
