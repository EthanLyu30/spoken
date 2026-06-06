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


def test_daily_lines_returns_set():
    payload = json.dumps(
        {
            "lines": [
                {"text": "Keep going.", "author": "Pip", "zh": "继续前进。"},
                {"text": "You've got this.", "author": "Anonymous", "zh": "你可以的。"},
            ]
        }
    )
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.get("/api/daily-lines?n=2")
        assert resp.status_code == 200
        lines = resp.json()["lines"]
        assert len(lines) == 2
        assert lines[0]["text"] == "Keep going."
        assert lines[0]["zh"] == "继续前进。"
    finally:
        app.dependency_overrides.clear()


def test_daily_lines_caps_to_n():
    payload = json.dumps({"lines": [{"text": f"line {i}"} for i in range(6)]})
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.get("/api/daily-lines?n=3")
        assert resp.status_code == 200
        assert len(resp.json()["lines"]) == 3
        # defaulted fields are populated
        assert resp.json()["lines"][0]["author"] == "Anonymous"
    finally:
        app.dependency_overrides.clear()


def test_daily_lines_bad_json_502():
    app.dependency_overrides[get_client] = lambda: _Stub("not json")
    try:
        resp = client.get("/api/daily-lines")
        assert resp.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_daily_lines_service_error_503():
    class _Boom:
        async def chat(self, messages, **_kwargs):
            raise DeepSeekError("nope")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        resp = client.get("/api/daily-lines")
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
