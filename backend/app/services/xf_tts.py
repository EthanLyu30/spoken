"""科大讯飞 在线语音合成 (TTS) over WebSocket.

Streams the synthesised audio frames back and concatenates them into a single
audio blob. The HMAC handshake lives in ``xf_auth``.
"""

from __future__ import annotations

import base64
import json

import websockets

from app.core.config import Settings, get_settings
from app.services.xf_auth import build_auth_url

_HOST = "tts-api.xfyun.cn"
_PATH = "/v2/tts"


class XfTtsError(RuntimeError):
    """Raised when an iFlytek TTS request cannot be completed."""


class XfTtsClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def synthesize(
        self,
        text: str,
        *,
        vcn: str = "x5_enus_flossie_flow",
        aue: str = "lame",  # lame -> mp3; raw -> 16k PCM
    ) -> bytes:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfTtsError("iFlytek credentials are not configured")

        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        frame = {
            "common": {"app_id": s.xf_app_id},
            "business": {
                "aue": aue,
                "vcn": vcn,
                "tte": "UTF8",
                "auf": "audio/L16;rate=16000",
            },
            "data": {
                "status": 2,
                "text": base64.b64encode(text.encode()).decode(),
            },
        }

        audio = bytearray()
        try:
            async with websockets.connect(url, max_size=None) as ws:
                await ws.send(json.dumps(frame))
                async for message in ws:
                    resp = json.loads(message)
                    if resp.get("code") != 0:
                        raise XfTtsError(
                            f"iFlytek TTS error {resp.get('code')}: {resp.get('message')}"
                        )
                    data = resp.get("data") or {}
                    if data.get("audio"):
                        audio.extend(base64.b64decode(data["audio"]))
                    if data.get("status") == 2:
                        break
        except XfTtsError:
            raise
        except Exception as exc:  # network / protocol
            raise XfTtsError(f"iFlytek TTS request failed: {exc}") from exc

        if not audio:
            raise XfTtsError("iFlytek TTS returned no audio")
        return bytes(audio)
