"""科大讯飞 在线语音合成 (TTS) over WebSocket.

Builds the HMAC-SHA256 handshake URL iFlytek requires, streams the synthesised
audio frames back and concatenates them into a single audio blob.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from email.utils import format_datetime
from urllib.parse import urlencode

import websockets

from app.core.config import Settings, get_settings

_HOST = "tts-api.xfyun.cn"
_PATH = "/v2/tts"
_URL = f"wss://{_HOST}{_PATH}"


class XfTtsError(RuntimeError):
    """Raised when an iFlytek TTS request cannot be completed."""


def _auth_url(api_key: str, api_secret: str) -> str:
    date = format_datetime(datetime.now(timezone.utc), usegmt=True)
    signature_origin = f"host: {_HOST}\ndate: {date}\nGET {_PATH} HTTP/1.1"
    signature = base64.b64encode(
        hmac.new(
            api_secret.encode(), signature_origin.encode(), hashlib.sha256
        ).digest()
    ).decode()
    authorization_origin = (
        f'api_key="{api_key}", algorithm="hmac-sha256", '
        f'headers="host date request-line", signature="{signature}"'
    )
    authorization = base64.b64encode(authorization_origin.encode()).decode()
    query = urlencode({"authorization": authorization, "date": date, "host": _HOST})
    return f"{_URL}?{query}"


class XfTtsClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def synthesize(
        self,
        text: str,
        *,
        vcn: str = "xiaoyan",
        aue: str = "lame",  # lame -> mp3
    ) -> bytes:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfTtsError("iFlytek credentials are not configured")

        url = _auth_url(s.xf_api_key, s.xf_api_secret)
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
