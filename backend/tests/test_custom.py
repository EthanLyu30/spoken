import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


class _Stub:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list = []

    async def chat(self, messages, **_kwargs):
        self.calls.append(messages)
        return self.payload


_SCENE = {
    "title": "Opening a Bank Account",
    "title_zh": "去银行开户",
    "partner_role": "Dana, a friendly bank teller",
    "goal": "Open a checking account and ask about fees.",
    "persona": "You are Dana at the front desk. Guide the learner through opening an account.",
    "opening_line": "Hi! Welcome in. How can I help you today?",
}


def test_custom_scenario_builds_scene():
    app.dependency_overrides[get_client] = lambda: _Stub(json.dumps(_SCENE))
    try:
        resp = client.post("/api/custom-scenario", json={"description": "去银行开户"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["title_zh"] == "去银行开户"
        assert data["opening_line"].startswith("Hi!")
    finally:
        app.dependency_overrides.clear()


def test_custom_scenario_bad_json_502():
    app.dependency_overrides[get_client] = lambda: _Stub("not json")
    try:
        resp = client.post("/api/custom-scenario", json={"description": "x y"})
        assert resp.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_custom_scenario_service_error_503():
    class _Boom:
        async def chat(self, messages, **_kwargs):
            raise DeepSeekError("nope")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        resp = client.post("/api/custom-scenario", json={"description": "a scene"})
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_chat_with_custom_scene_returns_opening():
    # With a custom scene and no user turn yet, the opener is returned verbatim.
    app.dependency_overrides[get_client] = lambda: _Stub("unused")
    try:
        resp = client.post(
            "/api/chat",
            json={"scenario_id": "custom", "messages": [], "custom": _SCENE},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["opening"] is True
        assert body["reply"] == _SCENE["opening_line"]
    finally:
        app.dependency_overrides.clear()


def test_chat_with_custom_scene_uses_persona():
    reply = "That's great, what kind of account were you thinking?"
    stub = _Stub(reply)
    app.dependency_overrides[get_client] = lambda: stub
    try:
        resp = client.post(
            "/api/chat",
            json={
                "scenario_id": "custom",
                "messages": [
                    {"role": "assistant", "content": _SCENE["opening_line"]},
                    {"role": "user", "content": "I'd like to open an account."},
                ],
                "custom": _SCENE,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["reply"] == reply
        # The custom persona made it into the system prompt.
        system = stub.calls[0][0]["content"]
        assert "Dana" in system
    finally:
        app.dependency_overrides.clear()


def test_feedback_with_custom_scene():
    fb = {
        "overall": 80,
        "summary": "Nice work.",
        "scores": [
            {"key": "fluency", "label_en": "Fluency", "label_zh": "流利度", "score": 80},
            {"key": "grammar", "label_en": "Grammar", "label_zh": "语法", "score": 78},
            {"key": "vocabulary", "label_en": "Vocabulary", "label_zh": "词汇", "score": 82},
            {"key": "task", "label_en": "Task", "label_zh": "任务", "score": 85},
        ],
        "corrections": [],
        "phrases": [],
        "tip": "继续加油。",
    }
    app.dependency_overrides[get_client] = lambda: _Stub(json.dumps(fb))
    try:
        resp = client.post(
            "/api/feedback",
            json={
                "scenario_id": "custom",
                "messages": [{"role": "user", "content": "I want to open an account."}],
                "custom": _SCENE,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["scenario_id"] == "custom"
        assert resp.json()["overall"] == 80
    finally:
        app.dependency_overrides.clear()
