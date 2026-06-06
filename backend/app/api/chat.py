"""Dialogue endpoint: one role-play turn powered by DeepSeek.

The client sends the scenario id and the conversation so far; the server builds
the system prompt, calls DeepSeek, and returns the AI partner's next line. When
there is no user turn yet, it returns the scripted scene opener without calling
the model (deterministic and instant).
"""

from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.data import scenarios as catalog
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.dialogue import build_messages

router = APIRouter(tags=["chat"])


def get_client() -> DeepSeekClient:
    """Dependency so tests can override the DeepSeek client."""
    return DeepSeekClient()


def _resolve_scenario(req: ChatRequest):
    if req.custom is not None:
        return catalog.scene_from_custom(req.custom)
    scenario = catalog.get_scenario(req.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {req.scenario_id}")
    return scenario


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest, client: DeepSeekClient = Depends(get_client)
) -> ChatResponse:
    if req.custom is not None:
        scenario = catalog.scene_from_custom(req.custom)
    else:
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
        reply = await client.chat(messages, temperature=0.85)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ChatResponse(scenario_id=scenario.id, reply=reply)


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest, client: DeepSeekClient = Depends(get_client)
) -> StreamingResponse:
    """Stream the partner's reply as plain-text deltas (lower perceived latency).

    The client falls back to POST /chat if the stream fails, so this never has to
    error mid-response.
    """
    scenario = _resolve_scenario(req)
    messages = build_messages(scenario, req.messages)

    async def gen() -> AsyncIterator[bytes]:
        try:
            async for delta in client.chat_stream(messages, temperature=0.85):
                yield delta.encode("utf-8")
        except DeepSeekError:
            return  # end the stream; an empty body makes the client fall back

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
