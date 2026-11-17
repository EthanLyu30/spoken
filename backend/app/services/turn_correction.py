"""DeepSeek-powered grammar and expression feedback for one learner turn."""

from __future__ import annotations

import json

from pydantic import ValidationError

from app.data.scenarios import ScenarioDef
from app.schemas.turn_correction import (
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.core.observability import span, trace_classify

_SYSTEM = """You are a concise English coach for a Chinese learner.
Analyse only the learner's current sentence in the supplied role-play context.
Return one JSON object with exactly:
- natural: boolean
- suggestion: one complete natural English sentence the learner can say
- issues: 0-6 objects, each with kind ("grammar" or "expression"), original,
  replacement, and a brief Chinese note
- explanation: one brief encouraging Chinese summary

Do not invent an error. If the sentence is natural, set natural=true and issues=[].
Keep the learner's intended meaning. Do not answer the role-play partner.

Example JSON:
{"natural":false,"suggestion":"I went there yesterday.","issues":[{"kind":"grammar",
"original":"go","replacement":"went","note":"描述昨天的事情，用过去式。"}],
"explanation":"意思很清楚，注意过去式。"}"""


def build_turn_correction_messages(
    scenario: ScenarioDef,
    request: TurnCorrectionRequest,
) -> list[dict[str, str]]:
    context = request.previous_partner_message or "(no previous partner line)"
    user = (
        f"Scenario: {scenario.title} — {scenario.goal}\n"
        f"Partner's previous line: {context}\n"
        f"Learner's current sentence: {request.text}\n\n"
        "Return the correction JSON now."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


async def generate_turn_correction(
    scenario: ScenarioDef,
    request: TurnCorrectionRequest,
    client: DeepSeekClient,
) -> TurnCorrectionResponse:
    messages = build_turn_correction_messages(scenario, request)
    for attempt in (1, 2):
        raw = await client.chat(
            messages,
            temperature=0.2 if attempt == 1 else 0,
            max_tokens=700,
            response_format={"type": "json_object"},
        )
        try:
            with span("turn_correction.parse", provider="local", attempt=attempt):
                data = json.loads(raw)
                data["original"] = request.text
                response = TurnCorrectionResponse.model_validate(data)
        except (json.JSONDecodeError, TypeError, ValidationError) as exc:
            if attempt == 2:
                trace_classify("TurnCorrectionParseError", type(exc).__name__)
                raise DeepSeekError("纠错分析暂时不可用，请稍后重试。") from exc
            messages[-1]["content"] += (
                "\nRegenerate the correction. Match the example JSON field types exactly. "
                "Use a boolean for natural, an array (never null) for issues, and "
                "short non-empty strings for suggestion, explanation, and issue text."
            )
            continue
        if response.natural and response.issues:
            response = response.model_copy(update={"issues": []})
        return response
