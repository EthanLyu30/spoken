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

_SYSTEM = """You are a concise English coach for a Chinese learner.
Analyse only the learner's current sentence in the supplied role-play context.
Return one JSON object with exactly:
- natural: boolean
- suggestion: one complete natural English sentence the learner can say
- issues: 0-6 objects, each with kind ("grammar" or "expression"), original,
  replacement, and a brief Chinese note
- explanation: one brief encouraging Chinese summary

Do not invent an error. If the sentence is natural, set natural=true and issues=[].
Keep the learner's intended meaning. Do not answer the role-play partner."""


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
    raw = await client.chat(
        build_turn_correction_messages(scenario, request),
        temperature=0.2,
        max_tokens=700,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(raw)
        data["original"] = request.text
        response = TurnCorrectionResponse(**data)
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise DeepSeekError(f"could not parse turn correction: {exc}") from exc
    if response.natural and response.issues:
        response = response.model_copy(update={"issues": []})
    return response
