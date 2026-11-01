"""iFlytek assessment: paced live PCM upload and bounded result reception."""
from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator, Awaitable, Callable
import json

import websockets

from app.core.config import Settings, get_settings
from app.core.observability import span, trace_attribute, traced
from app.services.xf_auth import build_auth_url

_HOST = "ise-api.xfyun.cn"
_PATH = "/v2/open-ise"
_FRAME = 1280  # 40 ms of 16 kHz / 16-bit mono
_FINAL_TIMEOUT = 15
_SESSION_TIMEOUT = 210
MAX_AUDIO_BYTES = 180 * 16000 * 2


class XfIseError(RuntimeError):
    """An assessment failed or exceeded its deadline."""


class XfIseClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def evaluate_raw(self, text: str, pcm: bytes, *, language: str = "en") -> str:
        """Compatible buffered entry point; shares live transport and deadlines."""
        if not pcm:
            raise XfIseError("no audio to evaluate")

        async def audio():
            yield pcm

        return await self.evaluate_stream(text, audio(), language=language)

    @traced("pronunciation.assess", provider="xfyun", transport="websocket")
    async def evaluate_stream(
        self, text: str, audio: AsyncIterator[bytes], *, language: str = "en",
        on_ready: Callable[[], Awaitable[None]] | None = None,
    ) -> str:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfIseError("iFlytek credentials are not configured")
        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        trace_attribute("model", "en_vip" if language == "en" else "cn_vip")
        tasks: list[asyncio.Task] = []
        try:
            async with asyncio.timeout(_SESSION_TIMEOUT):
                async with websockets.connect(
                    url, max_size=2 * 1024 * 1024, open_timeout=10, close_timeout=2,
                ) as ws:
                    await ws.send(json.dumps({
                        "common": {"app_id": s.xf_app_id},
                        "business": {
                            "category": "read_sentence", "rstcd": "utf8", "sub": "ise",
                            "group": "pupil", "ent": "en_vip" if language == "en" else "cn_vip",
                            "tte": "utf-8", "cmd": "ssb", "auf": "audio/L16;rate=16000",
                            "aue": "raw", "text": "\ufeff" + text,
                        },
                        "data": {"status": 0, "data": ""},
                    }))
                    receiver = asyncio.create_task(self._receive(ws))
                    tasks.append(receiver)
                    if on_ready:
                        await on_ready()
                    sender = asyncio.create_task(self._upload(ws, audio))
                    tasks.append(sender)
                    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    if receiver in done:
                        receiver.result()  # Surface provider errors before capture ends.
                    await sender
                    with span("pronunciation.final", provider="xfyun"):
                        return await asyncio.wait_for(asyncio.shield(receiver), _FINAL_TIMEOUT)
        except XfIseError:
            raise
        except TimeoutError as exc:
            raise XfIseError("iFlytek ISE request timed out") from exc
        except Exception as exc:
            raise XfIseError(f"iFlytek ISE request failed: {exc}") from exc
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    @traced("pronunciation.upload", provider="xfyun")
    async def _upload(self, ws, audio: AsyncIterator[bytes]) -> None:
        pending = bytearray()
        total = 0
        first = True
        next_send_at = 0.0
        loop = asyncio.get_running_loop()

        async def send(chunk: bytes, *, final: bool = False):
            nonlocal first, next_send_at
            delay = next_send_at - loop.time()
            if delay > 0:
                await asyncio.sleep(delay)
            next_send_at = loop.time() + .04
            await ws.send(json.dumps({
                "business": {"cmd": "auw", "aus": 4 if final else (1 if first else 2), "aue": "raw"},
                "data": {"status": 2 if final else 1, "data": base64.b64encode(chunk).decode()},
            }))
            first = False

        try:
            async for chunk in audio:
                total += len(chunk)
                if total > MAX_AUDIO_BYTES:
                    raise XfIseError("audio exceeds 180 seconds")
                pending.extend(chunk)
                offset = 0
                while len(pending) - offset >= _FRAME:
                    frame = bytes(pending[offset:offset + _FRAME])
                    offset += _FRAME
                    await send(frame)
                if offset:
                    del pending[:offset]
            if not total:
                raise XfIseError("no audio to evaluate")
            if pending:
                await send(bytes(pending))
            await send(b"", final=True)
        finally:
            close = getattr(audio, "aclose", None)
            if close:
                await close()

    async def _receive(self, ws) -> str:
        result_xml = None
        async for message in ws:
            response = json.loads(message)
            if response.get("code") != 0:
                raise XfIseError(f"iFlytek ISE error {response.get('code')}: {response.get('message')}")
            data = response.get("data") or {}
            if data.get("data"):
                result_xml = base64.b64decode(data["data"]).decode("utf-8", "ignore")
            if data.get("status") == 2:
                if result_xml:
                    return result_xml
                break
        raise XfIseError("iFlytek ISE returned no result")
