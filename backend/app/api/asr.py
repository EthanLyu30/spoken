"""Speech-to-text: buffered POST /asr and live streaming WS /asr/stream (iFlytek IAT)."""

import json

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)

from app.core.config import Settings, get_settings
from app.services.xf_asr import XfAsrClient, XfAsrError, XfAsrStream

router = APIRouter(tags=["asr"])


def get_asr_client() -> XfAsrClient:
    """Dependency so tests can override the iFlytek client."""
    return XfAsrClient()


@router.post("/asr")
async def asr(
    request: Request,
    language: str = "en_us",
    client: XfAsrClient = Depends(get_asr_client),
) -> dict:
    pcm = await request.body()
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty audio body")
    try:
        text = await client.transcribe(pcm, language=language)
    except XfAsrError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": text}


def get_asr_stream_factory():
    """A factory that builds one live IAT session; overridable in tests."""

    def make(settings: Settings, on_partial, *, language: str = "en_us") -> XfAsrStream:
        return XfAsrStream(settings, on_partial, language=language)

    return make


async def _relay_utterance(websocket: WebSocket, settings, make_stream, language: str) -> bool:
    """Relay one utterance to iFlytek. Returns True if the call has ended.

    Binary frames are forwarded as PCM; a ``{"type":"end"}`` text frame flushes
    iFlytek and sends the final transcript. The iFlytek session is opened lazily
    on the first audio frame so a silent turn never opens a connection.
    """
    stream: XfAsrStream | None = None

    async def on_partial(text: str) -> None:
        await websocket.send_json({"type": "partial", "text": text})

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                return True
            data = msg.get("bytes")
            text = msg.get("text")
            if data is not None:
                if stream is None:
                    stream = make_stream(settings, on_partial, language=language)
                    await stream.open()
                await stream.send(data)
            elif text is not None:
                ctrl = json.loads(text) if text else {}
                kind = ctrl.get("type")
                if kind == "end":
                    final = await stream.finish() if stream else ""
                    await websocket.send_json({"type": "final", "text": final})
                    return False
                if kind == "close":
                    return True
    except WebSocketDisconnect:
        return True
    except XfAsrError as exc:
        await websocket.send_json({"type": "error", "message": str(exc)})
        return False
    finally:
        if stream is not None:
            await stream.abort()


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
      then, per utterance:
        client → binary PCM frames (16 kHz/16-bit/mono), then ``{"type":"end"}``
        server → ``{"type":"partial","text":...}`` … then ``{"type":"final","text":...}``
      client → ``{"type":"close"}`` or disconnect ends the call.

    On any error the client should fall back to the buffered POST /asr path.
    """
    await websocket.accept()
    try:
        hello = await websocket.receive_text()
    except WebSocketDisconnect:
        return
    try:
        payload = json.loads(hello)
    except (json.JSONDecodeError, TypeError):
        payload = {}
    if payload.get("type") != "start":
        await websocket.close()
        return
    if not (settings.xf_app_id and settings.xf_api_key and settings.xf_api_secret):
        await websocket.send_json(
            {"type": "error", "message": "iFlytek credentials are not configured"}
        )
        await websocket.close()
        return
    language = payload.get("language") or "en_us"
    await websocket.send_json({"type": "ready"})
    try:
        while True:
            ended = await _relay_utterance(websocket, settings, make_stream, language)
            if ended:
                break
    except WebSocketDisconnect:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
