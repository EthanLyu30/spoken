import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app

client = TestClient(app)


class _StubDefine:
    async def chat(self, messages, **_kwargs):
        return json.dumps({"meaning": "测试释义", "example": "This is a test."})


def test_add_list_master_delete():
    r = client.post(
        "/api/words",
        json={"text": "brew", "scenario_id": "cafe", "meaning": "冲泡", "example": "Let me brew coffee."},
    )
    assert r.status_code == 201
    body = r.json()
    wid = body["id"]
    assert body["text"] == "brew" and body["meaning"] == "冲泡" and body["mastered"] is False

    assert any(w["id"] == wid for w in client.get("/api/words").json())

    p = client.patch(f"/api/words/{wid}", json={"mastered": True})
    assert p.status_code == 200 and p.json()["mastered"] is True

    assert client.delete(f"/api/words/{wid}").status_code == 204
    assert not any(w["id"] == wid for w in client.get("/api/words").json())


def test_add_auto_defines_when_missing():
    app.dependency_overrides[get_client] = lambda: _StubDefine()
    try:
        r = client.post("/api/words", json={"text": "to go"})
        assert r.status_code == 201
        assert r.json()["meaning"] == "测试释义"
        assert r.json()["example"] == "This is a test."
    finally:
        app.dependency_overrides.clear()


def test_patch_missing_404():
    assert client.patch("/api/words/999999", json={"mastered": True}).status_code == 404


def test_delete_missing_404():
    assert client.delete("/api/words/999999").status_code == 404


def test_add_is_idempotent_and_stores_kind():
    payload = {
        "text": "a unique sentence here",
        "meaning": "x",
        "example": "y",
        "kind": "sentence",
    }
    a = client.post("/api/words", json=payload)
    b = client.post("/api/words", json=payload)
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] == b.json()["id"]  # no duplicate row
    assert a.json()["kind"] == "sentence"
