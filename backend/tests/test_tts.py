from fastapi.testclient import TestClient

from app.api.tts import get_tts_client
from app.main import app
from app.services.xf_tts import XfTtsError

client = TestClient(app)


class _StubTts:
    def __init__(self, audio: bytes = b"\x00\x00\x01\x00\x02\x00\x03\x00") -> None:
        self.audio = audio  # raw 16-bit PCM bytes
        self.vcn: str | None = None
        self.aue: str | None = None

    async def synthesize(self, text, *, vcn=None, aue="raw", **_kwargs):
        self.vcn = vcn
        self.aue = aue
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


def test_tts_uses_scenario_voice():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post("/api/tts", json={"text": "hi", "scenario_id": "interview"})
        assert resp.status_code == 200
        assert stub.vcn == "henry"
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
