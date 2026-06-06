"""Hint endpoint: when the learner is stuck, suggest a few things to say next."""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.data import scenarios as catalog
from app.schemas.hint import HintRequest, HintResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["hint"])

_SYSTEM = """A Chinese learner is practising spoken English in a role-play and needs a nudge. Given the scenario and the conversation so far, suggest 2-3 short, natural things THE LEARNER could say next.

- Each suggestion is one short spoken sentence in simple, natural English (max ~12 words).
- They must fit the learner's side of THIS scene and respond to the partner's last line.
- Vary them a little so the learner has real choices.
- Return ONLY a JSON object: {"suggestions": ["...", "..."]}."""


@router.post("/hint", response_model=HintResponse)
async def hint(
    req: HintRequest, client: DeepSeekClient = Depends(get_client)
) -> HintResponse:
    scenario = catalog.get_scenario(req.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {req.scenario_id}")

    transcript = "\n".join(
        f"{'Partner' if m.role == 'assistant' else 'Learner'}: {m.content}"
        for m in req.messages
    )
    user = (
        f"Scenario: {scenario.title} — {scenario.goal}\n\n"
        f"Conversation so far:\n{transcript or '(not started yet)'}\n\n"
        "Suggest what the learner could say next."
    )
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]
    try:
        raw = await client.chat(
            messages,
            temperature=0.6,
            max_tokens=200,
            response_format={"type": "json_object"},
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        items = [s for s in data.get("suggestions", []) if isinstance(s, str) and s.strip()]
        return HintResponse(suggestions=items[:3])
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse hints") from exc
