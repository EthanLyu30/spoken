"""科大讯飞 语音听写 (IAT / ASR) over WebSocket.

Takes a buffer of 16 kHz / 16-bit / mono PCM, streams it to iFlytek in 40 ms
frames and assembles the recognised transcript.
"""

from __future__ import annotations

import asyncio
import base64
import json

import websockets

from app.core.config import Settings, get_settings
from app.services.xf_auth import build_auth_url

_HOST = "iat-api.xfyun.cn"
_PATH = "/v2/iat"
_FRAME = 1280  # 40 ms of 16 kHz / 16-bit mono audio


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
            await asyncio.sleep(0.04)  # iFlytek recommends ~40 ms between frames
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
