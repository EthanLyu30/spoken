"""Regressions for ownership, long practice sessions and interrupted replies."""

import json
from types import SimpleNamespace

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.core import security
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_device_header_cannot_read_or_delete_account_words():
    reg = client.post("/api/auth/register", json={"email": "owner-regression@example.com", "password": "secret123"}).json()
    auth = {"Authorization": f"Bearer {reg['token']}"}
    word = client.post("/api/words", headers=auth, json={"text": "private-marker", "meaning": "m", "example": "e"}).json()
    forged = {"X-Client-Id": f"u:{reg['user']['id']}"}
    assert client.get("/api/words", headers=forged).status_code == 400
    assert client.delete(f"/api/words/{word['id']}", headers=forged).status_code == 400
    assert any(w["id"] == word["id"] for w in client.get("/api/words", headers=auth).json())


@pytest.mark.parametrize("authorization", ["Bearer expired-or-forged", "Basic not-a-session"])
def test_invalid_authorization_never_falls_back_to_guest(authorization):
    assert client.get("/api/words", headers={"Authorization": authorization, "X-Client-Id": "real-guest"}).status_code == 401


def test_overlong_device_ids_are_rejected_instead_of_colliding():
    assert client.get("/api/words", headers={"X-Client-Id": "a" * 65}).status_code == 400


def test_missing_jwt_secret_does_not_use_a_public_signing_key(monkeypatch):
    monkeypatch.setattr(security, "get_settings", lambda: SimpleNamespace(jwt_secret=""))
    forged = jwt.encode({"sub": "1"}, "dev-insecure-secret-change-me-in-production", algorithm="HS256")
    assert security.decode_token(forged) is None


def session_payload(practice_id):
    return {"scenario_id": "cafe", "client_session_id": practice_id, "messages": [{"role": "user", "content": "A latte please."}], "overall": 80}


def test_session_retry_is_idempotent_but_new_practice_is_saved():
    owner = {"X-Client-Id": "session-retry-regression"}
    first = client.post("/api/sessions", headers=owner, json=session_payload("practice-first"))
    retry = client.post("/api/sessions", headers=owner, json=session_payload("practice-first"))
    second = client.post("/api/sessions", headers=owner, json=session_payload("practice-second"))
    assert first.status_code == retry.status_code == second.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    assert second.json()["id"] != first.json()["id"]
    assert len(client.get("/api/sessions", headers=owner).json()) == 2


def test_idempotency_key_is_scoped_to_owner():
    a = client.post("/api/sessions", headers={"X-Client-Id": "retry-owner-a"}, json=session_payload("shared-practice-id"))
    b = client.post("/api/sessions", headers={"X-Client-Id": "retry-owner-b"}, json=session_payload("shared-practice-id"))
    assert a.status_code == b.status_code == 201
    assert a.json()["id"] != b.json()["id"]


def test_long_practice_saves_the_full_transcript():
    payload = session_payload("long-practice")
    payload["messages"] = [{"role": "user", "content": f"Sentence {i}."} for i in range(100)]
    response = client.post("/api/sessions", headers={"X-Client-Id": "long-practice-owner"}, json=payload)
    assert response.status_code == 201
    assert len(response.json()["messages"]) == 100


def test_existing_sqlite_history_survives_the_session_identity_migration(monkeypatch):
    from sqlalchemy import create_engine
    from app import db
    legacy = create_engine("sqlite:///:memory:")
    try:
        with legacy.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE sessions (id INTEGER PRIMARY KEY, client_id VARCHAR(64), scenario_id VARCHAR(64), overall INTEGER, summary TEXT, tip TEXT, created_at DATETIME)")
            conn.exec_driver_sql("INSERT INTO sessions (id, client_id, scenario_id, overall) VALUES (1, 'old-device', 'cafe', 82)")
        monkeypatch.setattr(db, "engine", legacy)
        monkeypatch.setattr(db, "_url", "sqlite:///:memory:")
        db.init_db()
        db.init_db()  # upgrades are idempotent
        with legacy.connect() as conn:
            row = conn.exec_driver_sql("SELECT client_id, overall, client_session_id FROM sessions WHERE id = 1").one()
            assert tuple(row) == ("old-device", 82, None)
            indexes = {row[1] for row in conn.exec_driver_sql("PRAGMA index_list(sessions)")}
            assert "uq_sessions_owner_practice" in indexes
    finally:
        legacy.dispose()


def test_long_chat_uses_bounded_recent_context():
    received = []

    class Stub:
        async def chat(self, messages, **kwargs):
            received.extend(messages)
            return "What would you like next?"

    app.dependency_overrides[get_client] = Stub
    history = [{"role": "user" if i % 2 else "assistant", "content": f"Turn {i}."} for i in range(82)]
    response = client.post("/api/chat", json={"scenario_id": "cafe", "messages": history})
    assert response.status_code == 200
    assert len(received) <= 42  # two fixed prompt messages plus forty recent turns
    assert received[-1]["content"] == "Turn 81."
    assert not any(m["content"] == "Turn 0." for m in received)


@pytest.mark.parametrize("broken", [False, True])
def test_event_stream_distinguishes_completion_from_partial_failure(broken):
    class Stub:
        async def chat_stream(self, messages, **kwargs):
            yield "Hello, "
            if broken:
                raise DeepSeekError("simulated upstream failure")
            yield "你好!"

    app.dependency_overrides[get_client] = Stub
    response = client.post("/api/chat/stream", headers={"Accept": "text/event-stream"}, json={"scenario_id": "cafe", "messages": [{"role": "user", "content": "Hello."}]})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    frames = response.text.strip().split("\n\n")
    events = [(frame.splitlines()[0], json.loads(frame.split("data: ", 1)[1])) for frame in frames]
    assert events[0] == ("event: delta", {"text": "Hello, "})
    assert events[-1][0] == ("event: error" if broken else "event: done")
    assert ("event: done" in response.text) is not broken
