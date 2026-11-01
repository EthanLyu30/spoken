"""Pronunciation assessment endpoint: reference text + PCM -> scores (iFlytek ISE)."""

import asyncio
import json
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.schemas.pronunciation import PronunciationResult
from app.core.observability import trace_error
from app.services.pronunciation import parse_ise_xml
from app.services.xf_ise import MAX_AUDIO_BYTES, XfIseClient, XfIseError

router = APIRouter(tags=["pronunciation"])


def get_ise_client() -> XfIseClient:
    """Dependency so tests can override the iFlytek client."""
    return XfIseClient()


@router.post("/pronunciation", response_model=PronunciationResult)
async def pronunciation(
    request: Request,
    text: str,
    language: str = "en",
    client: XfIseClient = Depends(get_ise_client),
) -> PronunciationResult:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Missing reference text")
    pcm = await request.body()
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty audio body")
    try:
        xml = await client.evaluate_raw(text, pcm, language=language)
    except XfIseError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        return parse_ise_xml(xml)
    except (ValueError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse ISE result") from exc


@router.websocket("/pronunciation/stream")
async def pronunciation_stream(ws: WebSocket, client: XfIseClient = Depends(get_ise_client)):
    """Capture and assess concurrently; original HTTP callers remain supported."""
    await ws.accept()
    try:
        async with asyncio.timeout(210):
            start = await asyncio.wait_for(ws.receive_json(), 5)
            if not isinstance(start, dict) or start.get("type") != "start":
                raise ValueError("Expected start message")
            text = start.get("text")
            language = start.get("language", "en")
            if not isinstance(text, str) or not text.strip() or len(text) > 2000:
                raise ValueError("Reference text must contain 1–2000 characters")
            if language not in ("en", "cn"):
                raise ValueError("Unsupported language")

            async def ready():
                await ws.send_json({"type": "ready"})

            async def audio():
                total = 0
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        raise WebSocketDisconnect(message.get("code", 1000))
                    chunk = message.get("bytes")
                    if chunk is not None:
                        total += len(chunk)
                        if len(chunk) > 65536 or len(chunk) % 2 or total > MAX_AUDIO_BYTES:
                            raise ValueError("Invalid audio size (maximum 180 seconds)")
                        if chunk:
                            yield chunk
                    else:
                        command = json.loads(message.get("text", ""))
                        if isinstance(command, dict) and command.get("type") == "end" and total:
                            return
                        raise ValueError("Expected audio followed by end")

            xml = await client.evaluate_stream(text, audio(), language=language, on_ready=ready)
            result = parse_ise_xml(xml)
            await ws.send_json({"type": "result", "result": result.model_dump()})
    except WebSocketDisconnect:
        trace_error("cancelled")
        return
    except (TimeoutError, XfIseError, ValueError, ET.ParseError) as exc:
        if isinstance(exc.__cause__, WebSocketDisconnect):
            trace_error("cancelled")
            return
        trace_error("timeout" if isinstance(exc, TimeoutError) or isinstance(exc.__cause__, TimeoutError) else "error")
        try:
            await ws.send_json({"type": "error", "message": "语音评测未完成，请重试。"})
        except (RuntimeError, WebSocketDisconnect):
            return
    finally:
        try:
            await ws.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
