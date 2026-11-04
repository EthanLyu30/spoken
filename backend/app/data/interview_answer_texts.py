"""Text transcripts of reviewed video sample-answer slides.

The extraction is intentionally separate from the source-reference notes: the
notes are editorial summaries, while these are OCR transcripts of the sample
answers shown in the public videos. A missing file is not fatal; callers fall
back to the existing written sample.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.data.interview_questions import InterviewSet, get_interview_sets

ANSWER_TEXTS_PATH = Path(__file__).with_name("inspire_answer_texts.json")


@dataclass(frozen=True)
class AnswerTexts:
    question_index: int
    options: tuple[str, ...]


def load_answer_texts(
    path: Path | None = None, *, sets: tuple[InterviewSet, ...] | None = None,
) -> dict[str, tuple[AnswerTexts, ...]]:
    source = ANSWER_TEXTS_PATH if path is None else path
    if not source.exists():
        return {}
    document = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("Answer texts must be an object")
    rows = document.get("sets")
    if not isinstance(rows, list):
        raise ValueError("Answer texts sets must be a list")
    bank = {group.id: group for group in (get_interview_sets() if sets is None else sets) if group.collection == "inspire"}
    result: dict[str, tuple[AnswerTexts, ...]] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Answer text row must be an object")
        set_id = row.get("set_id")
        if not isinstance(set_id, str) or set_id in result:
            raise ValueError("Answer text set_id is invalid or duplicated")
        # Callers may validate against a smaller test/tenant catalogue. Ignore
        # transcripts that do not belong to that catalogue.
        if set_id not in bank:
            continue
        answers = row.get("answers")
        if not isinstance(answers, list) or len(answers) != 4:
            raise ValueError("Answer texts require four answers per set")
        parsed: list[AnswerTexts] = []
        for index, answer in enumerate(answers, 1):
            if not isinstance(answer, dict) or answer.get("question_index") != index:
                raise ValueError("Answer text question order is invalid")
            options = answer.get("options")
            if not isinstance(options, list):
                raise ValueError("Answer text options must be a list")
            texts = []
            for option in options:
                if not isinstance(option, dict):
                    raise ValueError("Answer text option must be an object")
                text = option.get("text")
                if not isinstance(text, str) or len(text.strip()) < 20:
                    raise ValueError("Answer text option is too short")
                texts.append(text.strip())
            if not texts:
                raise ValueError("Answer text option list must not be empty")
            parsed.append(AnswerTexts(index, tuple(texts)))
        result[set_id] = tuple(parsed)
    return result
