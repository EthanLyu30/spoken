"""科大讯飞 在线语音合成 (TTS) over WebSocket.

Streams the synthesised audio frames back and concatenates them into a single
audio blob. The HMAC handshake lives in ``xf_auth``.
"""

from __future__ import annotations

import array
import asyncio
import base64
import io
import json
import wave
from collections.abc import AsyncIterator

import websockets

from app.core.config import Settings, get_settings
from app.services.xf_auth import build_auth_url

_HOST = "tts-api.xfyun.cn"
_PATH = "/v2/tts"

SAMPLE_RATE = 16000


def smooth_silences(
    pcm: bytes,
    *,
    rate: int = SAMPLE_RATE,
    win_ms: int = 10,
    near_zero_peak: int = 64,
    min_trim_ms: int = 120,
    inter_keep_ms: int = 60,
    sentence_min_ms: int = 320,
    sentence_keep_ms: int = 180,
) -> bytes:
    """Shorten only long, near-digital-zero gaps in iFlytek PCM.

    Peak detection deliberately preserves quiet consonants and low-energy speech.
    Leading/trailing near-zero padding is removed. Long internal gaps keep 60 ms,
    while sentence-sized gaps keep 180 ms.
    """
    samples = array.array("h")
    samples.frombytes(pcm)
    win = max(1, rate * win_ms // 1000)
    nwin = (len(samples) + win - 1) // win
    if nwin == 0:
        return pcm

    non_silent = [False] * nwin
    for index in range(nwin):
        segment = samples[index * win : (index + 1) * win]
        non_silent[index] = bool(segment) and max(
            abs(value) for value in segment
        ) > near_zero_peak

    out = array.array("h")
    index = 0
    seen_voice = False
    while index < nwin:
        if non_silent[index]:
            out.extend(samples[index * win : (index + 1) * win])
            seen_voice = True
            index += 1
            continue

        end = index
        while end < nwin and not non_silent[end]:
            end += 1
        run_ms = (end - index) * win_ms
        trailing = end >= nwin
        if not seen_voice or trailing:
            keep_ms = 0
        elif run_ms < min_trim_ms:
            keep_ms = run_ms
        elif run_ms >= sentence_min_ms:
            keep_ms = sentence_keep_ms
        else:
            keep_ms = inter_keep_ms
        keep_windows = min(end - index, keep_ms // win_ms)
        if keep_windows:
            out.extend(samples[index * win : (index + keep_windows) * win])
        index = end

    return out.tobytes() if out else pcm


def pcm16_to_wav(pcm: bytes, *, rate: int = SAMPLE_RATE, channels: int = 1) -> bytes:
    """Wrap 16-bit little-endian PCM in a single WAV container.

    iFlytek streams audio as many small frames. Concatenating MP3 frames leaves
    encoder padding between them (audible as choppy, syllable-by-syllable
    speech); concatenating raw PCM and wrapping it once is gapless.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(pcm)
    return buf.getvalue()


class XfTtsError(RuntimeError):
    """Raised when an iFlytek TTS request cannot be completed."""


class XfTtsClient:
    def __init__(self, settings: Settings | None = None) -> None:
        self._s = settings or get_settings()

    async def synthesize(
        self, text: str, **kwargs,
    ) -> bytes:
        return b"".join([chunk async for chunk in self.synthesize_stream(text, **kwargs)])

    async def synthesize_stream(
        self,
        text: str,
        *,
        vcn: str = "x5_enus_flossie_flow",
        aue: str = "raw",  # raw -> 16k PCM (gapless); lame -> mp3
        speed: int = 54,  # 0-100, 50 = neutral
        pitch: int = 52,  # 0-100, 50 = neutral
        volume: int = 80,  # 0-100
    ) -> AsyncIterator[bytes]:
        s = self._s
        if not (s.xf_app_id and s.xf_api_key and s.xf_api_secret):
            raise XfTtsError("iFlytek credentials are not configured")

        url = build_auth_url(_HOST, _PATH, s.xf_api_key, s.xf_api_secret)
        frame = {
            "common": {"app_id": s.xf_app_id},
            "business": {
                "aue": aue,
                "vcn": vcn,
                "speed": speed,
                "pitch": pitch,
                "volume": volume,
                "tte": "UTF8",
                "auf": "audio/L16;rate=16000",
            },
            "data": {
                "status": 2,
                "text": base64.b64encode(text.encode()).decode(),
            },
        }

        received = False
        complete = False
        try:
            async with asyncio.timeout(30), websockets.connect(url, max_size=2 * 1024 * 1024, open_timeout=10, close_timeout=3) as ws:
                await ws.send(json.dumps(frame))
                async for message in ws:
                    resp = json.loads(message)
                    if resp.get("code") != 0:
                        raise XfTtsError(
                            f"iFlytek TTS error {resp.get('code')}: {resp.get('message')}"
                        )
                    data = resp.get("data") or {}
                    if data.get("audio"):
                        audio = base64.b64decode(data["audio"])
                        if audio:
                            received = True
                            yield audio
                    if data.get("status") == 2:
                        complete = True
                        break
        except XfTtsError:
            raise
        except Exception as exc:  # network / protocol
            raise XfTtsError(f"iFlytek TTS request failed: {exc}") from exc

        if not received:
            raise XfTtsError("iFlytek TTS returned no audio")
        if not complete:
            raise XfTtsError("iFlytek TTS ended before completing the audio")
