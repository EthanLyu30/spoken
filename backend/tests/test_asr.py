from fastapi.testclient import TestClient

from app.api.asr import get_asr_client
from app.main import app
from app.services.xf_asr import XfAsrError

client = TestClient(app)


class _StubAsr:
    def __init__(self, text: str = "hello world") -> None:
        self.text = text

    async def transcribe(self, pcm, **_kwargs):
        return self.text


def test_asr_returns_transcript():
    app.dependency_overrides[get_asr_client] = lambda: _StubAsr("how are you")
    try:
        resp = client.post("/api/asr", content=b"\x00\x01\x02\x03")
        assert resp.status_code == 200
        assert resp.json()["text"] == "how are you"
    finally:
        app.dependency_overrides.clear()


def test_asr_empty_body_400():
    resp = client.post("/api/asr", content=b"")
    assert resp.status_code == 400


def test_asr_service_error_503():
    class _Boom:
        async def transcribe(self, pcm, **_kwargs):
            raise XfAsrError("nope")

    app.dependency_overrides[get_asr_client] = lambda: _Boom()
    try:
        resp = client.post("/api/asr", content=b"\x00\x01")
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
