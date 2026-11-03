"""Pronunciation assessment endpoint: reference text + PCM -> scores (iFlytek ISE)."""

import asyncio
import json
import xml.etree.ElementTree as ET
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect

from app.api.audio import read_pcm
from app.schemas.pronunciation import PronunciationResult
from app.core.observability import span, trace_error
from app.services.pronunciation import parse_ise_xml
from app.services.xf_ise import MAX_AUDIO_BYTES, XfIseClient, XfIseError

router = APIRouter(tags=["pronunciation"])
_MAX_PENDING_PCM_BYTES = 512 * 1024
_MAX_PENDING_PCM_FRAMES = 4096


def get_ise_client() -> XfIseClient:
    """Dependency so tests can override the iFlytek client."""
    return XfIseClient()


@router.post("/pronunciation", response_model=PronunciationResult)
async def pronunciation(
    request: Request,
    text: str,
    language: str = "en",
    entry: Literal["turn_correction", "follow_read", "unknown"] = "unknown",
    client: XfIseClient = Depends(get_ise_client),
) -> PronunciationResult:
    text = text.strip()
    if not 1 <= len(text) <= 2000:
        raise HTTPException(status_code=400, detail="Reference text must contain 1–2000 characters")
    if language not in ("en", "cn"):
        raise HTTPException(status_code=400, detail="Unsupported language")
    pcm = await read_pcm(request)
    try:
        with span("pronunciation.request", entry=entry):
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
            entry = start.get("entry", "unknown")
            if not isinstance(text, str):
                raise ValueError("Reference text must contain 1–2000 characters")
            text = text.strip()
            if not 1 <= len(text) <= 2000:
                raise ValueError("Reference text must contain 1–2000 characters")
            if language not in ("en", "cn"):
                raise ValueError("Unsupported language")
            if entry not in ("turn_correction", "follow_read", "unknown"):
                raise ValueError("Unsupported entry")

            async def ready():
                await ws.send_json({"type": "ready"})

            # Keep receiving independently of paced/blocked provider uploads,
            # including while waiting for the final result after end. Reserve
            # one queue slot for end; a full audio queue must fail, never block
            # its only reader and hide a later disconnect.
            queue: asyncio.Queue[bytes | None] = asyncio.Queue(_MAX_PENDING_PCM_FRAMES + 1)
            queued_bytes = 0

            async def read_audio():
                nonlocal queued_bytes
                total = 0
                ended = False
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        raise WebSocketDisconnect(message.get("code", 1000))
                    if ended:
                        raise ValueError("Unexpected audio after end")
                    chunk = message.get("bytes")
                    if chunk is not None:
                        total += len(chunk)
                        if len(chunk) > 65536 or len(chunk) % 2 or total > MAX_AUDIO_BYTES:
                            raise ValueError("Invalid audio size (maximum 180 seconds)")
                        if chunk:
                            if (queued_bytes + len(chunk) > _MAX_PENDING_PCM_BYTES or
                                    queue.qsize() >= _MAX_PENDING_PCM_FRAMES):
                                raise ValueError("Pending audio queue exceeded")
                            queued_bytes += len(chunk)
                            queue.put_nowait(chunk)
                    else:
                        command = json.loads(message.get("text", ""))
                        if isinstance(command, dict) and command.get("type") == "end" and total:
                            ended = True
                            queue.put_nowait(None)
                            continue
                        raise ValueError("Expected audio followed by end")

            async def audio():
                nonlocal queued_bytes
                while True:
                    chunk = await queue.get()
                    if chunk is None:
                        return
                    queued_bytes -= len(chunk)
                    yield chunk

            source = audio()
            reader = asyncio.create_task(read_audio())
            with span("pronunciation.request", entry=entry):
                evaluator = asyncio.create_task(client.evaluate_stream(text, source, language=language, on_ready=ready))
                try:
                    done, _ = await asyncio.wait((reader, evaluator), return_when=asyncio.FIRST_COMPLETED)
                    if reader in done:
                        reader.result()  # Disconnect/protocol failures interrupt evaluation promptly.
                    xml = await evaluator
                finally:
                    for task in (reader, evaluator):
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(reader, evaluator, return_exceptions=True)
                    await source.aclose()
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
