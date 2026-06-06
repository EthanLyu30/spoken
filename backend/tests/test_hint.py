import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


class _Stub:
    def __init__(self, payload: str) -> None:
        self.payload = payload

    async def chat(self, messages, **_kwargs):
        return self.payload


def _body():
    return {
        "scenario_id": "cafe",
        "messages": [{"role": "assistant", "content": "What can I get you?"}],
    }


def test_hint_returns_suggestions():
    payload = json.dumps({"suggestions": ["I'd like a latte.", "Do you have oat milk?", "x"]})
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.post("/api/hint", json=_body())
        assert resp.status_code == 200
        s = resp.json()["suggestions"]
        assert s[0] == "I'd like a latte."
        assert len(s) == 3
    finally:
        app.dependency_overrides.clear()


def test_hint_unknown_scenario_404():
    resp = client.post("/api/hint", json={"scenario_id": "nope", "messages": []})
    assert resp.status_code == 404


def test_hint_service_error_503():
    class _Boom:
        async def chat(self, messages, **_kwargs):
            raise DeepSeekError("nope")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        resp = client.post("/api/hint", json=_body())
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
