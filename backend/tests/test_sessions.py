from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _payload():
    return {
        "scenario_id": "cafe",
        "messages": [
            {"role": "assistant", "content": "Hi! What can I get you?"},
            {"role": "user", "content": "A latte please."},
        ],
        "overall": 84,
        "summary": "Nice work!",
        "tip": "Keep it up.",
        "scores": [
            {"key": "fluency", "label_en": "Fluency", "label_zh": "流利度", "score": 82},
            {"key": "grammar", "label_en": "Grammar", "label_zh": "语法", "score": 80},
        ],
    }


def test_save_then_get_session():
    resp = client.post("/api/sessions", json=_payload())
    assert resp.status_code == 201
    body = resp.json()
    sid = body["id"]
    assert body["scenario_id"] == "cafe"
    assert len(body["messages"]) == 2

    got = client.get(f"/api/sessions/{sid}")
    assert got.status_code == 200
    detail = got.json()
    assert detail["overall"] == 84
    assert detail["scores"][0]["key"] == "fluency"
    assert detail["messages"][1]["content"] == "A latte please."


def test_list_sessions_returns_saved():
    client.post("/api/sessions", json=_payload())
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1
    assert {"id", "scenario_id", "overall", "created_at"} <= set(rows[0].keys())


def test_get_missing_session_returns_404():
    assert client.get("/api/sessions/999999").status_code == 404


def test_save_requires_messages():
    bad = _payload()
    bad["messages"] = []
    assert client.post("/api/sessions", json=bad).status_code == 422
