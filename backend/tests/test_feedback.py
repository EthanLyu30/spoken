import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app

client = TestClient(app)

VALID = {
    "overall": 84,
    "summary": "Nice work, you kept it going!",
    "scores": [
        {"key": "fluency", "label_en": "Fluency", "label_zh": "流利度", "score": 82},
        {"key": "grammar", "label_en": "Grammar", "label_zh": "语法", "score": 79},
        {"key": "vocabulary", "label_en": "Vocabulary", "label_zh": "词汇", "score": 85},
        {"key": "task", "label_en": "Task completion", "label_zh": "任务完成", "score": 88},
    ],
    "corrections": [
        {"original": "I very like it", "suggestion": "I really like it", "note": "用 really 修饰动词"}
    ],
    "phrases": [{"text": "a splash of milk", "note": "加一点点奶"}],
    "tip": "下次试着多解释原因。",
}


class _StubClient:
    def __init__(self, payload: str) -> None:
        self.payload = payload

    async def chat(self, messages, **_kwargs):
        return self.payload


def _conversation():
    return {
        "scenario_id": "cafe",
        "messages": [
            {"role": "assistant", "content": "Hi! What can I get you?"},
            {"role": "user", "content": "I very like a latte please."},
        ],
    }


def test_feedback_success():
    app.dependency_overrides[get_client] = lambda: _StubClient(json.dumps(VALID))
    try:
        resp = client.post("/api/feedback", json=_conversation())
        assert resp.status_code == 200
        body = resp.json()
        assert body["scenario_id"] == "cafe"
        assert body["overall"] == 84
        assert len(body["scores"]) == 4
        assert body["corrections"][0]["suggestion"] == "I really like it"
    finally:
        app.dependency_overrides.clear()


def test_feedback_anchors_categorized_corrections_to_learner_turns():
    valid = {"original": "a latte please", "suggestion": "a latte, please", "note": "加逗号",
             "category": "sentence_structure", "turn_index": 1}
    assistant = {**valid, "original": "What can I get you?", "turn_index": 0}
    fabricated = {**valid, "original": "a missing quote"}
    app.dependency_overrides[get_client] = lambda: _StubClient(json.dumps({
        **VALID, "corrections": [assistant, valid, fabricated, valid],
    }))
    try:
        response = client.post("/api/feedback", json=_conversation())
        assert response.status_code == 200
        assert response.json()["corrections"] == [{**valid, "marked": False, "self_marked": False}]
    finally:
        app.dependency_overrides.clear()


def test_feedback_keeps_an_explicit_deletion_quoted_from_the_learner():
    payload = _conversation()
    payload["messages"][1]["content"] = "I like the cats."
    deletion = {"original": "the", "suggestion": "", "note": "泛指时不加冠词。", "category": "articles", "turn_index": 1}
    word_fragment = {**deletion, "original": "he"}
    app.dependency_overrides[get_client] = lambda: _StubClient(json.dumps({**VALID, "corrections": [deletion, word_fragment]}))
    try:
        response = client.post("/api/feedback", json=payload)
        assert response.status_code == 200
        assert response.json()["corrections"] == [{**deletion, "marked": False, "self_marked": False}]
    finally:
        app.dependency_overrides.clear()


def test_feedback_unknown_scenario_404():
    resp = client.post(
        "/api/feedback",
        json={"scenario_id": "nope", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp.status_code == 404


def test_feedback_requires_a_learner_turn():
    resp = client.post(
        "/api/feedback",
        json={"scenario_id": "cafe", "messages": [{"role": "assistant", "content": "hi"}]},
    )
    assert resp.status_code == 400


def test_feedback_bad_json_maps_to_503():
    app.dependency_overrides[get_client] = lambda: _StubClient("definitely not json")
    try:
        resp = client.post("/api/feedback", json=_conversation())
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
