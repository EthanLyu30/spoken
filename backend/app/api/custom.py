"""Generate a role-play scene from a learner's short description (DeepSeek).

The learner types a brief idea (often in Chinese); DeepSeek expands it into a
full English role-play spec. The spec is returned to the client, which then
carries it back inline on chat / feedback requests (see ``ChatRequest.custom``).
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.schemas.custom import CustomScene, CustomSceneRequest
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["custom"])

_SYSTEM = """You design short English speaking-practice role-plays for Chinese learners.

Given the learner's brief description of a scene (which may be written in Chinese), invent one vivid, realistic role-play. You play the learner's conversation partner — never the learner.

Return ONLY a JSON object with exactly these keys:
- "title": a short, catchy English scene title.
- "title_zh": the same title in Chinese.
- "partner_role": who the AI plays, with a name and a trait, e.g. "Mia, a warm barista".
- "goal": one English sentence describing what the learner should accomplish.
- "persona": 2-3 sentences of scene and character detail so the partner stays in character and keeps the conversation flowing with natural follow-up questions.
- "opening_line": the partner's natural first spoken line in English — short, in character, and ending in a way that invites the learner to respond."""


_SUGGEST = """You suggest fresh English speaking-practice role-plays for Chinese learners.

Invent ONE interesting, realistic everyday scenario worth practising today. Favour variety and slightly less obvious situations (for example: returning a faulty gadget, asking a neighbour to keep the noise down, joining a gym, a parent-teacher chat) rather than the most common ones like ordering coffee or a job interview. You play the learner's conversation partner — never the learner.

Return ONLY a JSON object with exactly these keys:
- "title": a short, catchy English scene title.
- "title_zh": the same title in Chinese.
- "partner_role": who the AI plays, with a name and a trait.
- "goal": one English sentence describing what the learner should accomplish.
- "persona": 2-3 sentences of scene and character detail so the partner stays in character with natural follow-up questions.
- "opening_line": the partner's natural first spoken line in English — short, in character, inviting the learner to respond."""


async def _generate(client: DeepSeekClient, messages: list[dict], temperature: float) -> CustomScene:
    try:
        raw = await client.chat(
            messages,
            temperature=temperature,
            max_tokens=600,
            response_format={"type": "json_object"},
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        return CustomScene(**json.loads(raw))
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not build scene") from exc


@router.post("/custom-scenario", response_model=CustomScene)
async def custom_scenario(
    req: CustomSceneRequest,
    client: DeepSeekClient = Depends(get_client),
) -> CustomScene:
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": f"Scene the learner wants to practise: {req.description}"},
    ]
    return await _generate(client, messages, temperature=0.8)


@router.get("/scenario-suggestion", response_model=CustomScene)
async def scenario_suggestion(
    client: DeepSeekClient = Depends(get_client),
) -> CustomScene:
    """A fresh, ready-to-play scenario the client features as the day's pick."""
    messages = [
        {"role": "system", "content": _SUGGEST},
        {"role": "user", "content": "Suggest today's scene."},
    ]
    return await _generate(client, messages, temperature=1.0)
