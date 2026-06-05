from fastapi.testclient import TestClient

from app.api.tts import get_tts_client
from app.main import app
from app.services.xf_tts import XfTtsError

client = TestClient(app)


class _StubTts:
    def __init__(self, audio: bytes = b"ID3fake-mp3-bytes") -> None:
        self.audio = audio
        self.vcn: str | None = None

    async def synthesize(self, text, *, vcn=None, **_kwargs):
        self.vcn = vcn
        return self.audio


def test_tts_returns_audio():
    app.dependency_overrides[get_tts_client] = lambda: _StubTts()
    try:
        resp = client.post("/api/tts", json={"text": "Hello there"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert resp.content == b"ID3fake-mp3-bytes"
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
