"""科大讯飞 在线语音合成 (TTS) over WebSocket.

Streams the synthesised audio frames back and concatenates them into a single
audio blob. The HMAC handshake lives in ``xf_auth``.
"""

from __future__ import annotations

import array
import base64
import io
import json
import wave

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
    threshold: int = 320,
    min_trim_ms: int = 80,
    inter_cap_ms: int = 45,
    sentence_min_ms: int = 320,
    sentence_cap_ms: int = 200,
) -> bytes:
    """Collapse over-long silences inside iFlytek's English synthesis.

    The standard voices leave 80-160ms of dead air between many words, which
    sounds choppy / word-by-word. We keep natural micro-gaps (< ``min_trim_ms``)
    and real sentence pauses (capped to ``sentence_cap_ms``), but shrink the
    abnormal inter-word gaps to ``inter_cap_ms``. Leading/trailing silence is
    trimmed. Cuts happen only inside true silence, so there are no clicks.
    """
    samples = array.array("h")
    samples.frombytes(pcm)
    win = max(1, rate * win_ms // 1000)
    nwin = (len(samples) + win - 1) // win
    if nwin == 0:
        return pcm

    voiced = [False] * nwin
    for w in range(nwin):
        seg = samples[w * win : (w + 1) * win]
        if not seg:
            break
        rms = (sum(x * x for x in seg) / len(seg)) ** 0.5
        voiced[w] = rms >= threshold

    out = array.array("h")
    w = 0
    seen_voice = False
    while w < nwin:
        if voiced[w]:
            out.extend(samples[w * win : (w + 1) * win])
            seen_voice = True
            w += 1
            continue
        # silence run [w, e)
        e = w
        while e < nwin and not voiced[e]:
            e += 1
        run_ms = (e - w) * win_ms
        trailing = e >= nwin
        if not seen_voice or trailing:
            keep_ms = 0  # drop leading / trailing silence
        elif run_ms < min_trim_ms:
            keep_ms = run_ms  # natural micro-gap, leave it
        elif run_ms >= sentence_min_ms:
            keep_ms = sentence_cap_ms
        else:
            keep_ms = inter_cap_ms
        keep_win = min(e - w, keep_ms // win_ms)
        if keep_win:
            out.extend(samples[w * win : (w + keep_win) * win])
        w = e

    return out.tobytes() if len(out) else pcm


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
        self,
        text: str,
        *,
        vcn: str = "x5_enus_flossie_flow",
        aue: str = "raw",  # raw -> 16k PCM (gapless); lame -> mp3
        speed: int = 54,  # 0-100, 50 = neutral
        pitch: int = 52,  # 0-100, 50 = neutral
        volume: int = 80,  # 0-100
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
