"""科大讯飞 语音评测 (ISE) over WebSocket — pronunciation scoring.

Takes a reference sentence + 16 kHz mono PCM of the learner reading it, and
returns iFlytek's evaluation XML (parsed by ``app.services.pronunciation``).
"""

from __future__ import annotations

import asyncio
import base64
import json

import websockets

from app.core.config import Settings, get_settings
from app.services.xf_auth import build_auth_url

_HOST = "ise-api.xfyun.cn"
_PATH = "/v2/open-ise"
_FRAME = 1280  # 40 ms of 16 kHz / 16-bit mono


class XfIseError(RuntimeError):
    """Raised when an iFlytek ISE request cannot be completed."""


class XfIseClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def evaluate_raw(self, text: str, pcm: bytes, *, language: str = "en") -> str:
        """Return the raw evaluation XML string."""
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfIseError("iFlytek credentials are not configured")
        if not pcm:
            raise XfIseError("no audio to evaluate")

        ent = "en_vip" if language == "en" else "cn_vip"
        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        result_xml: str | None = None
        try:
            async with websockets.connect(url, max_size=None) as ws:
                # 1) session begin: parameters + reference text
                ssb = {
                    "common": {"app_id": s.xf_app_id},
                    "business": {
                        "category": "read_sentence",
                        "rstcd": "utf8",
                        "sub": "ise",
                        "group": "pupil",
                        "ent": ent,
                        "tte": "utf-8",
                        "cmd": "ssb",
                        "auf": "audio/L16;rate=16000",
                        "aue": "raw",
                        "text": "﻿" + text,
                    },
                    "data": {"status": 0, "data": ""},
                }
                await ws.send(json.dumps(ssb))

                # 2) audio upload
                total = len(pcm)
                first = True
                for i in range(0, total, _FRAME):
                    chunk = pcm[i : i + _FRAME]
                    last = i + _FRAME >= total
                    aus = 1 if first else (4 if last else 2)
                    dstatus = 2 if last else 1
                    await ws.send(
                        json.dumps(
                            {
                                "business": {"cmd": "auw", "aus": aus, "aue": "raw"},
                                "data": {
                                    "status": dstatus,
                                    "data": base64.b64encode(chunk).decode(),
                                },
                            }
                        )
                    )
                    first = False
                    await asyncio.sleep(0.04)
                if total % _FRAME == 0:
                    await ws.send(
                        json.dumps(
                            {
                                "business": {"cmd": "auw", "aus": 4, "aue": "raw"},
                                "data": {"status": 2, "data": ""},
                            }
                        )
                    )

                # 3) receive result
                async for message in ws:
                    resp = json.loads(message)
                    if resp.get("code") != 0:
                        raise XfIseError(
                            f"iFlytek ISE error {resp.get('code')}: {resp.get('message')}"
                        )
                    data = resp.get("data") or {}
                    if data.get("data"):
                        result_xml = base64.b64decode(data["data"]).decode("utf-8", "ignore")
                    if data.get("status") == 2:
                        break
        except XfIseError:
            raise
        except Exception as exc:
            raise XfIseError(f"iFlytek ISE request failed: {exc}") from exc

        if not result_xml:
            raise XfIseError("iFlytek ISE returned no result")
        return result_xml
