from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app

client = TestClient(app)


class _StreamStub:
    async def chat_stream(self, messages, **_kwargs):
        for tok in ["Hello", " there", "!"]:
            yield tok


def _body():
    return {
        "scenario_id": "cafe",
        "messages": [
            {"role": "assistant", "content": "Hi!"},
            {"role": "user", "content": "hello"},
        ],
    }


def test_chat_stream_yields_text():
    app.dependency_overrides[get_client] = lambda: _StreamStub()
    try:
        resp = client.post("/api/chat/stream", json=_body())
        assert resp.status_code == 200
        assert resp.text == "Hello there!"
    finally:
        app.dependency_overrides.clear()


def test_chat_stream_unknown_scenario_404():
    resp = client.post("/api/chat/stream", json={"scenario_id": "nope", "messages": []})
    assert resp.status_code == 404
