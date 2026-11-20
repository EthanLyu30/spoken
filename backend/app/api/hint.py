"""Hint endpoint: when the learner is stuck, suggest a few things to say next."""

import json
import re

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import _resolve_scenario, get_client
from app.schemas.hint import HintRequest, HintResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["hint"])

_SYSTEM = """A Chinese learner is practising spoken English in a role-play and needs a nudge. Given the scenario and the conversation so far, suggest 2-3 short, natural things THE LEARNER could say next.

- Each suggestion is one short spoken sentence in simple, natural English (max ~12 words).
- They must fit the learner's side of THIS scene and respond to the partner's last line.
- Vary them a little so the learner has real choices.
- Give each sentence a faithful, short Simplified Chinese meaning that the learner can keep when saving it for later.
- Return ONLY a JSON object: {"suggestions": [{"sentence": "...", "meaning": "..."}]}.
"""


@router.post("/hint", response_model=HintResponse, response_model_exclude_defaults=True)
async def hint(
    req: HintRequest, client: DeepSeekClient = Depends(get_client)
) -> HintResponse:
    # Resolve catalogue OR custom/daily scene (raises 404 for an unknown id).
    scenario = _resolve_scenario(req)

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
            max_tokens=420,
            response_format={"type": "json_object"},
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        choices = data.get("suggestions") if isinstance(data, dict) else None
        if not isinstance(choices, list):
            raise ValueError("Expected a list of suggestions")
        items: dict[str, str] = {}
        for choice in choices:
            sentence = choice.get("sentence") if isinstance(choice, dict) else choice
            if not isinstance(sentence, str) or not 0 < len(sentence.strip()) <= 600:
                continue
            sentence = sentence.strip()
            if sentence not in items and len(items) == 3:
                continue
            items.setdefault(sentence, "")
            meaning = choice.get("meaning") if isinstance(choice, dict) else None
            if not items[sentence] and isinstance(meaning, str) and len(meaning.strip()) <= 400 and re.search(r"[\u3400-\u9fff]", meaning):
                items[sentence] = meaning.strip()
        return HintResponse(suggestions=list(items), meanings={sentence: meaning for sentence, meaning in items.items() if meaning})
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse hints") from exc
