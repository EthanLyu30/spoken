"""科大讯飞 语音听写 (IAT / ASR) over WebSocket.

Takes a buffer of 16 kHz / 16-bit / mono PCM, streams it to iFlytek in 40 ms
frames and assembles the recognised transcript.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Awaitable, Callable

import websockets

from app.core.config import Settings, get_settings
from app.services.xf_auth import build_auth_url

_HOST = "iat-api.xfyun.cn"
_PATH = "/v2/iat"
_FRAME = 1280  # 40 ms of 16 kHz / 16-bit mono audio
# The audio is already fully recorded by the time we get here, so there's no
# need to replay it to iFlytek at 1x real-time (a 6 s clip -> 6 s of latency).
# iFlytek tolerates faster-than-real-time upload for buffered audio; a small gap
# still avoids overrunning the server. This cuts post-utterance ASR lag ~4x.
_SEND_INTERVAL = 0.01  # 10 ms between 40 ms frames (was 40 ms)


class XfAsrError(RuntimeError):
    """Raised when an iFlytek ASR request cannot be completed."""


class XfAsrClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def transcribe(self, pcm: bytes, *, language: str = "en_us") -> str:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfAsrError("iFlytek credentials are not configured")
        if not pcm:
            raise XfAsrError("no audio to transcribe")

        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        transcript: list[str] = []
        try:
            async with websockets.connect(url, max_size=None) as ws:
                await asyncio.gather(
                    self._send(ws, pcm, language),
                    self._recv(ws, transcript),
                )
        except XfAsrError:
            raise
        except Exception as exc:  # network / protocol
            raise XfAsrError(f"iFlytek ASR request failed: {exc}") from exc

        return "".join(transcript).strip()

    async def _send(self, ws, pcm: bytes, language: str) -> None:
        total = len(pcm)
        first = True
        for i in range(0, total, _FRAME):
            chunk = pcm[i : i + _FRAME]
            last = i + _FRAME >= total
            status = 0 if first else (2 if last else 1)
            frame: dict = {
                "data": {
                    "status": status,
                    "format": "audio/L16;rate=16000",
                    "encoding": "raw",
                    "audio": base64.b64encode(chunk).decode(),
                }
            }
            if first:
                frame["common"] = {"app_id": self._s.xf_app_id}
                frame["business"] = {
                    "language": language,
                    "domain": "iat",
                    "accent": "mandarin",
                    "vad_eos": 10000,
                }
                first = False
            await ws.send(json.dumps(frame))
            await asyncio.sleep(_SEND_INTERVAL)  # pace uploads without 1x replay
        # Ensure a final frame if the audio length was an exact multiple.
        if total % _FRAME == 0:
            await ws.send(json.dumps({"data": {"status": 2, "audio": ""}}))

    async def _recv(self, ws, out: list[str]) -> None:
        async for message in ws:
            resp = json.loads(message)
            if resp.get("code") != 0:
                raise XfAsrError(
                    f"iFlytek ASR error {resp.get('code')}: {resp.get('message')}"
                )
            data = resp.get("data") or {}
            result = data.get("result") or {}
            for seg in result.get("ws", []):
                for cand in seg.get("cw", []):
                    out.append(cand.get("w", ""))
            if data.get("status") == 2:
                break


PartialCallback = Callable[[str], Awaitable[None]]


class XfAsrStream:
    """A single iFlytek IAT session that yields the transcript *as it arrives*.

    Unlike :class:`XfAsrClient` (which buffers a whole clip then transcribes),
    this drives one live utterance: audio is forwarded to iFlytek as it's
    captured and the growing transcript is pushed back through ``on_partial``
    so the UI can show live captions. The caller streams audio with
    :meth:`send`, then calls :meth:`finish` once the utterance ends (the front
    end's VAD decides when) to flush iFlytek and get the final text.

    One instance handles exactly one utterance; create a fresh one per turn.
    """

    def __init__(
        self,
        settings: Settings,
        on_partial: PartialCallback,
        *,
        language: str = "en_us",
    ) -> None:
        self._s = settings
        self._on_partial = on_partial
        self._language = language
        self._ws = None
        self._first = True
        self._words: list[str] = []
        self._recv_task: asyncio.Task | None = None
        self._done = asyncio.Event()
        self._error: XfAsrError | None = None
        self._closed = False

    async def open(self) -> None:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfAsrError("iFlytek credentials are not configured")
        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        try:
            self._ws = await websockets.connect(url, max_size=None)
        except Exception as exc:  # network / handshake
            raise XfAsrError(f"iFlytek ASR connect failed: {exc}") from exc
        self._recv_task = asyncio.create_task(self._stream_recv())

    async def send(self, pcm: bytes) -> None:
        """Forward a chunk of 16 kHz/16-bit mono PCM, split into 40 ms frames."""
        if self._ws is None:
            raise XfAsrError("stream not open")
        for i in range(0, len(pcm), _FRAME):
            chunk = pcm[i : i + _FRAME]
            frame: dict = {
                "data": {
                    "status": 0 if self._first else 1,
                    "format": "audio/L16;rate=16000",
                    "encoding": "raw",
                    "audio": base64.b64encode(chunk).decode(),
                }
            }
            if self._first:
                frame["common"] = {"app_id": self._s.xf_app_id}
                frame["business"] = {
                    "language": self._language,
                    "domain": "iat",
                    "accent": "mandarin",
                    "vad_eos": 10000,  # we end the turn ourselves via finish()
                }
                self._first = False
            await self._ws.send(json.dumps(frame))

    async def finish(self) -> str:
        """Signal end-of-utterance, wait for the final result, return it."""
        if self._ws is None:
            return ""
        try:
            await self._ws.send(json.dumps({"data": {"status": 2, "audio": ""}}))
        except Exception:
            pass  # connection may already be closing; still drain what we have
        try:
            await asyncio.wait_for(self._done.wait(), timeout=10)
        except asyncio.TimeoutError:
            pass
        await self._close()
        if self._error:
            raise self._error
        return "".join(self._words).strip()

    async def abort(self) -> None:
        """Tear down without waiting for a final result (call cancelled)."""
        await self._close()

    async def _stream_recv(self) -> None:
        try:
            async for message in self._ws:  # type: ignore[union-attr]
                resp = json.loads(message)
                if resp.get("code") != 0:
                    self._error = XfAsrError(
                        f"iFlytek ASR error {resp.get('code')}: {resp.get('message')}"
                    )
                    break
                data = resp.get("data") or {}
                result = data.get("result") or {}
                grew = False
                for seg in result.get("ws", []):
                    for cand in seg.get("cw", []):
                        self._words.append(cand.get("w", ""))
                        grew = True
                if grew:
                    text = "".join(self._words).strip()
                    if text:
                        try:
                            await self._on_partial(text)
                        except Exception:
                            pass  # a dropped caption must not kill the stream
                if data.get("status") == 2:
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # network / protocol mid-stream
            self._error = XfAsrError(f"iFlytek ASR stream failed: {exc}")
        finally:
            self._done.set()

    async def _close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._recv_task:
            self._recv_task.cancel()
            try:
                await self._recv_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
