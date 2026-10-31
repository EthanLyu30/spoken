"""Dialogue endpoint: one role-play turn powered by DeepSeek.

The client sends the scenario id and the conversation so far; the server builds
the system prompt, calls DeepSeek, and returns the AI partner's next line. When
there is no user turn yet, it returns the scripted scene opener without calling
the model (deterministic and instant).
"""

from collections.abc import AsyncIterator
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.data import scenarios as catalog
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.dialogue import build_messages
from app.services.speaking_scope import dialogue_redirect
from app.core.observability import trace_error

router = APIRouter(tags=["chat"])


def get_client(request: Request) -> DeepSeekClient:
    """Dependency so tests can override the DeepSeek client."""
    return DeepSeekClient(http_client=getattr(request.app.state, "deepseek_http", None))


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
    scenario = _resolve_scenario(req)

    # No user turn yet -> return the scripted opener (no model call).
    if not any(m.role == "user" for m in req.messages):
        return ChatResponse(
            scenario_id=scenario.id, reply=scenario.opening_line, opening=True
        )

    redirect = dialogue_redirect(req.messages)
    if redirect is not None:
        return ChatResponse(scenario_id=scenario.id, reply=redirect)

    messages = build_messages(scenario, req.messages)
    try:
        reply = await client.chat(messages, temperature=0.85)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ChatResponse(scenario_id=scenario.id, reply=reply)


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest, request: Request, client: DeepSeekClient = Depends(get_client)
) -> StreamingResponse:
    """Stream the partner's reply as plain-text deltas (lower perceived latency).

    The client falls back to POST /chat if the stream fails, so this never has to
    error mid-response.
    """
    scenario = _resolve_scenario(req)
    redirect = dialogue_redirect(req.messages)
    messages = build_messages(scenario, req.messages)
    events = "text/event-stream" in request.headers.get("accept", "")

    def frame(event: str, data: dict) -> bytes:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")

    async def gen() -> AsyncIterator[bytes]:
        if redirect is not None:
            yield frame("delta", {"text": redirect}) if events else redirect.encode("utf-8")
            if events:
                yield frame("done", {})
            return
        if not any(m.role == "user" for m in req.messages):
            yield frame("delta", {"text": scenario.opening_line}) if events else scenario.opening_line.encode("utf-8")
            if events:
                yield frame("done", {})
            return
        try:
            async for delta in client.chat_stream(messages, temperature=0.85):
                yield frame("delta", {"text": delta}) if events else delta.encode("utf-8")
        except DeepSeekError as exc:
            trace_error(exc)
            if events:
                yield frame("error", {"message": "回复中断，请重试这一回合。"})
            return
        if events:
            yield frame("done", {})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream" if events else "text/plain; charset=utf-8",
        headers={
            # Ask nginx-style proxies (self-hosted) and Render's edge not to
            # buffer the response, so tokens reach the client as they're produced.
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )
