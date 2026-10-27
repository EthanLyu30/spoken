from fastapi.testclient import TestClient

from app.api.asr import get_asr_client
from app.main import app
from app.services.xf_asr import XfAsrError
from app.core.config import get_settings
from types import SimpleNamespace

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


def test_direct_asr_authorization_is_not_cached_and_never_contains_the_api_secret():
    cfg = SimpleNamespace(xf_app_id="public-app", xf_api_key="test-key", xf_api_secret="server-only-secret")
    app.dependency_overrides[get_settings] = lambda: cfg
    try:
        r = client.post("/api/asr/session", headers={"X-Client-Id": "direct-qa"})
        assert r.status_code == 200
        assert r.json()["app_id"] == "public-app"
        assert r.json()["url"].startswith("wss://iat-api.xfyun.cn/v2/iat?")
        assert "authorization=" in r.json()["url"]
        assert "server-only-secret" not in r.text
        assert r.headers["cache-control"] == "no-store"
    finally:
        app.dependency_overrides.clear()


def test_direct_asr_authorization_rejects_missing_credentials():
    cfg = SimpleNamespace(xf_app_id="", xf_api_key="", xf_api_secret="")
    app.dependency_overrides[get_settings] = lambda: cfg
    try:
        r = client.post("/api/asr/session")
        assert r.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_direct_asr_authorization_validates_the_device_identity():
    r = client.post("/api/asr/session", headers={"X-Client-Id": "u:123"})
    assert r.status_code == 400
