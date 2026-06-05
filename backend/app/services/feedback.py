"""Post-session feedback: the slow path on the *text* conversation.

Sends the transcript to DeepSeek and asks for a structured JSON assessment
(scores, corrections, useful phrases, a tip). Pronunciation is intentionally
out of scope here — it needs audio and arrives with the voice milestone.
"""

from __future__ import annotations

import json

from pydantic import ValidationError

from app.data.scenarios import ScenarioDef
from app.schemas.chat import ChatMessage
from app.schemas.feedback import FeedbackResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError

_SYSTEM = """You are a warm, encouraging English-speaking coach reviewing a short practice conversation between a Chinese learner (role: Learner) and an AI partner (role: Partner). Assess ONLY the learner's English.

Return a single JSON object, no prose, with exactly these keys:
- "overall": integer 0-100, an encouraging holistic score.
- "summary": one or two short, friendly sentences (English; a short Chinese clause is fine).
- "scores": array of exactly 4 objects for fluency, grammar, vocabulary and task completion. Each is {"key","label_en","label_zh","score"} with key in [fluency, grammar, vocabulary, task] and score 0-100.
- "corrections": array (0-4) of the learner's most useful fixes, each {"original","suggestion","note"}, where note is a brief Chinese explanation.
- "phrases": array (0-5) of natural words/phrases the learner could use next time, each {"text","note"} with a short Chinese gloss.
- "tip": one actionable Chinese tip for next time.

Be supportive and specific. Base everything only on what the learner actually said; do not invent mistakes. If the learner barely spoke, encourage them and give gentle, lower scores."""


def build_feedback_messages(
    scenario: ScenarioDef, history: list[ChatMessage]
) -> list[dict[str, str]]:
    lines = [
        f"{'Learner' if m.role == 'user' else 'Partner'}: {m.content}" for m in history
    ]
    transcript = "\n".join(lines)
    user = (
        f"Scenario: {scenario.title} — {scenario.goal}\n\n"
        f"Transcript:\n{transcript}\n\n"
        "Now produce the JSON feedback object."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


async def generate_feedback(
    scenario: ScenarioDef, history: list[ChatMessage], client: DeepSeekClient
) -> FeedbackResponse:
    messages = build_feedback_messages(scenario, history)
    raw = await client.chat(
        messages,
        temperature=0.3,
        max_tokens=900,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(raw)
        data["scenario_id"] = scenario.id
        return FeedbackResponse(**data)
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise DeepSeekError(f"could not parse feedback: {exc}") from exc
