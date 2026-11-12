"""Speech-to-text: buffered POST /asr and live streaming WS /asr/stream (iFlytek IAT)."""

import asyncio
import json
import re

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse

from app.api.audio import read_pcm
from app.core.config import Settings, get_settings
from app.core.deps import get_optional_client_id
from app.services.xf_auth import build_auth_url
from app.services.xf_asr import XfAsrClient, XfAsrError, XfAsrStream
from app.core.observability import TraceContext, span, trace_attribute, trace_classify, trace_error
from app.services.xf_ise import MAX_AUDIO_BYTES

router = APIRouter(tags=["asr"])
_START_TIMEOUT = 5.0
_SESSION_TIMEOUT = 210.0
_MAX_FRAME_BYTES = 64 * 1024


class _ProtocolError(ValueError):
    """A malformed or oversized client frame; safe to return to the caller."""


@router.post("/asr/session")
def asr_session(
    settings: Settings = Depends(get_settings),
    _client_id: str = Depends(get_optional_client_id),
) -> JSONResponse:
    """Issue a timestamp-signed provider handshake; audio stays in the browser."""
    if not (settings.xf_app_id and settings.xf_api_key and settings.xf_api_secret):
        raise HTTPException(status_code=503, detail="语音识别暂不可用。", headers={"Cache-Control": "no-store"})
    return JSONResponse({
        "url": build_auth_url("iat-api.xfyun.cn", "/v2/iat", settings.xf_api_key, settings.xf_api_secret),
        "app_id": settings.xf_app_id,
    }, headers={"Cache-Control": "no-store"})


def get_asr_client() -> XfAsrClient:
    """Dependency so tests can override the iFlytek client."""
    return XfAsrClient()


@router.post("/asr")
async def asr(
    request: Request,
    language: str = "en_us",
    client: XfAsrClient = Depends(get_asr_client),
) -> dict:
    pcm = await read_pcm(request)
    try:
        text = await client.transcribe(pcm, language=language)
    except XfAsrError as exc:
        match = re.search(r"iFlytek ASR error (\d+)", str(exc))
        code = match.group(1) if match else None
        trace_classify("XfAsrQuotaError" if code == "11201" else "XfAsrError", "XfAsrError")
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": text}


def get_asr_stream_factory():
    """A factory that builds one live IAT session; overridable in tests."""

    def make(settings: Settings, on_partial, *, language: str = "en_us") -> XfAsrStream:
        return XfAsrStream(settings, on_partial, language=language)

    return make


async def _relay_utterance(websocket: WebSocket, settings, make_stream, language: str, first_message=None) -> bool:
    """Relay one utterance to iFlytek. Returns True if the call has ended.

    Binary frames are forwarded as PCM; a ``{"type":"end"}`` text frame flushes
    iFlytek and sends the final transcript. The iFlytek session is opened lazily
    on the first audio frame so a silent turn never opens a connection.
    """
    stream: XfAsrStream | None = None
    total = 0

    async def on_partial(text: str) -> None:
        await websocket.send_json({"type": "partial", "text": text})

    try:
        while True:
            msg = first_message if first_message is not None else await websocket.receive()
            first_message = None
            if msg.get("type") == "websocket.disconnect":
                trace_error("cancelled")
                return True
            data = msg.get("bytes")
            text = msg.get("text")
            if data is not None:
                total += len(data)
                if len(data) > _MAX_FRAME_BYTES or len(data) % 2:
                    raise _ProtocolError("PCM frames must be even-sized and at most 64 KiB")
                if total > MAX_AUDIO_BYTES:
                    raise _ProtocolError("Utterance audio exceeds 180 seconds")
                if not data:
                    continue
                if stream is None:
                    stream = make_stream(settings, on_partial, language=language)
                    await stream.open()
                await stream.send(data)
            elif text is not None:
                try:
                    ctrl = json.loads(text)
                except (json.JSONDecodeError, TypeError) as exc:
                    raise _ProtocolError("Invalid JSON control frame") from exc
                if not isinstance(ctrl, dict):
                    raise _ProtocolError("Control frame must be a JSON object")
                kind = ctrl.get("type")
                if kind == "end":
                    final = await stream.finish() if stream else ""
                    await websocket.send_json({"type": "final", "text": final})
                    return False
                if kind == "close":
                    trace_error("cancelled")
                    return True
                raise _ProtocolError("Expected end or close control frame")
            else:
                raise _ProtocolError("Expected PCM audio or a control frame")
    except WebSocketDisconnect:
        trace_error("cancelled")
        return True
    except XfAsrError as exc:
        provider_code = getattr(stream, "_provider_code", None)
        if not provider_code:
            code_match = re.search(r"iFlytek ASR error (\d{1,5})\b", str(exc))
            provider_code = code_match.group(1) if code_match else None
        payload = {"type": "error", "message": str(exc)}
        if provider_code and re.fullmatch(r"[1-9]\d{0,4}", provider_code):
            code = int(provider_code)
            trace_attribute("provider_code", code)
            payload["code"] = code
        failure_stage = getattr(stream, "_failure_stage", None)
        if failure_stage in {"provider_stream", "provider_finalize"}:
            trace_attribute("failure_stage", failure_stage)
        try:
            await websocket.send_json(payload)
        except (RuntimeError, WebSocketDisconnect):
            pass
        # Remaining frames belong to this failed utterance; close the relay.
        raise
    finally:
        if stream is not None:
            await stream.abort()


def _turn_context(message: dict) -> dict | None:
    text = message.get("text")
    if not text or len(text) > 256:
        return None
    try:
        payload = json.loads(text)
    except ValueError:
        return None
    return payload if isinstance(payload, dict) and payload.get("type") == "turn" else None


async def _tracked_utterance(websocket, settings, make_stream, language, context):
    sink = getattr(websocket.app.state, "telemetry_sink", None)
    interaction = context.get("interaction_id")
    if not sink or not isinstance(interaction, str) or not re.fullmatch(r"[a-f0-9]{32}", interaction):
        return await _relay_utterance(websocket, settings, make_stream, language)
    run = context.get("test_run_id")
    trace = TraceContext(
        operation="WS /api/asr/stream", interaction_id=interaction,
        test_run_id=run if isinstance(run, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,64}", run) else None,
    )
    try:
        with trace, span("asr.relay", provider="xfyun", transport="relay"):
            return await _relay_utterance(websocket, settings, make_stream, language)
    finally:
        sink.submit(trace.record())


@router.websocket("/asr/stream")
async def asr_stream(
    websocket: WebSocket,
    settings: Settings = Depends(get_settings),
    make_stream=Depends(get_asr_stream_factory),
) -> None:
    """Live captions for call mode: stream PCM in, get partial/final text back.

    Protocol (JSON text frames + raw binary audio frames):
      client → ``{"type":"start","language":"en_us"}``  (handshake)
      server → ``{"type":"ready"}`` | ``{"type":"error","message":...}``
      both sides may opt into trace_context; an optional ``turn`` frame then
      supplies the interaction and test-run IDs before the audio of each utterance.
      then, per utterance:
        client → binary PCM frames (16 kHz/16-bit/mono), then ``{"type":"end"}``
        server → ``{"type":"partial","text":...}`` … then ``{"type":"final","text":...}``
      client → ``{"type":"close"}`` or disconnect ends the call.

    On any error the client should fall back to the buffered POST /asr path.
    """
    await websocket.accept()
    try:
        async with asyncio.timeout(_SESSION_TIMEOUT):
            hello = await asyncio.wait_for(websocket.receive(), _START_TIMEOUT)
            if hello.get("type") == "websocket.disconnect":
                return
            try:
                payload = json.loads(hello.get("text") or "")
            except (json.JSONDecodeError, TypeError) as exc:
                raise _ProtocolError("Expected a JSON start message") from exc
            if not isinstance(payload, dict) or payload.get("type") != "start":
                raise _ProtocolError("Expected a start message")
            if not (settings.xf_app_id and settings.xf_api_key and settings.xf_api_secret):
                await websocket.send_json(
                    {"type": "error", "message": "iFlytek credentials are not configured"}
                )
                return
            language = payload.get("language") or "en_us"
            trace_context = payload.get("trace_context") is True
            await websocket.send_json({"type": "ready", **({"trace_context": True} if trace_context else {})})
            while True:
                if trace_context:
                    first_message = await websocket.receive()
                    context = _turn_context(first_message)
                    if context is not None:
                        ended = await _tracked_utterance(websocket, settings, make_stream, language, context)
                    else:
                        ended = await _relay_utterance(websocket, settings, make_stream, language, first_message)
                else:
                    ended = await _relay_utterance(websocket, settings, make_stream, language)
                if ended:
                    break
    except TimeoutError:
        try:
            await websocket.send_json({"type": "error", "message": "ASR session timed out"})
        except (RuntimeError, WebSocketDisconnect):
            pass
    except _ProtocolError as exc:
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except (RuntimeError, WebSocketDisconnect):
            pass
    except (WebSocketDisconnect, XfAsrError):
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
