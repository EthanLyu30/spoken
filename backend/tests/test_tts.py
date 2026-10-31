import array
import asyncio
import base64
import json

import pytest

from fastapi.testclient import TestClient

from app.api.tts import get_tts_client
from app.main import app
from app.services.xf_tts import SAMPLE_RATE, XfTtsClient, XfTtsError, smooth_silences

client = TestClient(app)


class _StubTts:
    def __init__(self, audio: bytes = b"\x00\x00\x01\x00\x02\x00\x03\x00") -> None:
        self.audio = audio  # raw 16-bit PCM bytes
        self.vcn: str | None = None
        self.aue: str | None = None
        self.speed: int | None = None
        self.pitch: int | None = None

    async def synthesize(self, text, *, vcn=None, aue="raw", speed=None, pitch=None, **_kwargs):
        self.vcn = vcn
        self.aue = aue
        self.speed = speed
        self.pitch = pitch
        return self.audio


def test_tts_returns_wav_audio():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post("/api/tts", json={"text": "Hello there"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/wav"
        # PCM is wrapped in a single WAV container for gapless playback.
        assert resp.content[:4] == b"RIFF"
        assert resp.content[8:12] == b"WAVE"
        assert stub.aue == "raw"
    finally:
        app.dependency_overrides.clear()


def test_whole_audio_preserves_provider_pcm_and_natural_pauses():
    import io
    import wave
    tone = array.array('h', [8000, -8000] * 1600)
    pause = array.array('h', [0] * 8000)
    pcm = (tone + pause + tone).tobytes()
    app.dependency_overrides[get_tts_client] = lambda: _StubTts(pcm)
    try:
        response = client.post('/api/tts', json={'text': 'First sentence. Second sentence.'})
        assert response.status_code == 200
        with wave.open(io.BytesIO(response.content), 'rb') as audio:
            assert audio.readframes(audio.getnframes()) == pcm
    finally:
        app.dependency_overrides.clear()


def test_tts_uses_scenario_voice():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post("/api/tts", json={"text": "hi", "scenario_id": "interview"})
        assert resp.status_code == 200
        assert stub.vcn == "henry"
    finally:
        app.dependency_overrides.clear()


def test_tts_applies_user_overrides():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post(
            "/api/tts",
            json={"text": "hi", "scenario_id": "interview", "vcn": "x3_enus_emma_assist", "speed": 40, "pitch": 60},
        )
        assert resp.status_code == 200
        assert stub.vcn == "x3_enus_emma_assist"  # override beats scenario "henry"
        assert stub.speed == 40
        assert stub.pitch == 60
    finally:
        app.dependency_overrides.clear()


def test_tts_service_error_maps_to_503():
    class _Boom:
        async def synthesize(self, text, **_kwargs):
            raise XfTtsError("not configured")

    app.dependency_overrides[get_tts_client] = lambda: _Boom()
    try:
        resp = client.post("/api/tts", json={"text": "Hello"})
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_tts_rejects_empty_text():
    assert client.post("/api/tts", json={"text": ""}).status_code == 422


def test_smooth_silences_collapses_only_near_zero_internal_gap():
    rate = SAMPLE_RATE
    tone = array.array("h", [8000, -8000] * (rate // 10))  # 200 ms
    zero_gap = array.array("h", [0] * (rate // 5))  # 200 ms
    pcm = (tone + zero_gap + tone).tobytes()
    out = smooth_silences(pcm)
    assert len(out) < len(pcm)
    assert len(out) >= len((tone + tone).tobytes()) + int(rate * 0.06) * 2


def test_smooth_silences_preserves_low_energy_speech():
    rate = SAMPLE_RATE
    low_energy = array.array("h", [120, -120] * (rate // 2))  # 1 second
    pcm = low_energy.tobytes()
    assert smooth_silences(pcm) == pcm


def test_smooth_silences_preserves_low_energy_speech_between_loud_segments():
    rate = SAMPLE_RATE
    tone = array.array("h", [5000, -5000] * (rate // 10))  # 200 ms
    low_energy = array.array("h", [120, -120] * (rate // 10))  # 200 ms
    pcm = (tone + low_energy + tone).tobytes()
    assert smooth_silences(pcm) == pcm


def test_smooth_silences_keeps_longer_sentence_pause():
    rate = SAMPLE_RATE
    tone = array.array("h", [5000, -5000] * (rate // 10))
    sentence_gap = array.array("h", [0] * (rate // 2))  # 500 ms
    out = smooth_silences((tone + sentence_gap + tone).tobytes())
    kept_samples = len(out) // 2 - len(tone) * 2
    assert kept_samples >= int(rate * 0.18)


def test_tts_stream_returns_pcm_and_preserves_scenario_options():
    calls = []
    class Stub:
        async def synthesize_stream(self, text, **kwargs):
            calls.append((text, kwargs))
            yield b"\x01\x00"
            yield b"\x02\x00"
    app.dependency_overrides[get_tts_client] = Stub
    try:
        response = client.post("/api/tts/stream", json={"text": "Hello", "scenario_id": "interview", "speed": 44})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("audio/pcm")
        assert response.content == b"\x01\x00\x02\x00"
        assert calls[0][1]["vcn"] == "henry"
        assert calls[0][1]["speed"] == 44
    finally:
        app.dependency_overrides.clear()


def test_tts_stream_maps_startup_failure_to_503():
    class Stub:
        async def synthesize_stream(self, text, **kwargs):
            raise XfTtsError("not configured")
            yield b""  # async generator
    app.dependency_overrides[get_tts_client] = Stub
    try:
        assert client.post("/api/tts/stream", json={"text": "Hello"}).status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_tts_service_yields_first_frame_before_upstream_finishes(monkeypatch):
    from app.core.config import Settings
    from app.services import xf_tts
    class Socket:
        finished = False
        async def send(self, data):
            pass
        def __aiter__(self):
            return self.frames()
        async def frames(self):
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x01\x00").decode(), "status": 1}})
            self.finished = True
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x02\x00").decode(), "status": 2}})
    socket = Socket()
    class Connection:
        async def __aenter__(self):
            return socket
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection())
    async def run():
        service = XfTtsClient(Settings(xf_app_id="test", xf_api_key="test", xf_api_secret="test"))
        stream = service.synthesize_stream("Hello")
        assert await anext(stream) == b"\x01\x00"
        assert not socket.finished
        assert await anext(stream) == b"\x02\x00"
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
    asyncio.run(run())
