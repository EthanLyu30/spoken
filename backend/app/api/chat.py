"""Dialogue endpoint: one role-play turn powered by DeepSeek.

The client sends the scenario id and the conversation so far; the server builds
the system prompt, calls DeepSeek, and returns the AI partner's next line. When
there is no user turn yet, it returns the scripted scene opener without calling
the model (deterministic and instant).
"""

from fastapi import APIRouter, Depends, HTTPException

from app.data import scenarios as catalog
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.dialogue import build_messages

router = APIRouter(tags=["chat"])


def get_client() -> DeepSeekClient:
    """Dependency so tests can override the DeepSeek client."""
    return DeepSeekClient()


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest, client: DeepSeekClient = Depends(get_client)
) -> ChatResponse:
    scenario = catalog.get_scenario(req.scenario_id)
    if scenario is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown scenario: {req.scenario_id}"
        )

    # No user turn yet -> return the scripted opener (no model call).
    if not any(m.role == "user" for m in req.messages):
        return ChatResponse(
            scenario_id=scenario.id, reply=scenario.opening_line, opening=True
        )

    messages = build_messages(scenario, req.messages)
    try:
        reply = await client.chat(messages)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ChatResponse(scenario_id=scenario.id, reply=reply)
