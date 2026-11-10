from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app


def register(client):
    credentials = {"email": f"{uuid4().hex}@example.test", "password": "original-password"}
    result = client.post("/api/auth/register", json=credentials)
    assert result.status_code == 201
    return credentials, {"Authorization": f"Bearer {result.json()['token']}"}


def test_export_and_delete_account_progress():
    with TestClient(app) as client:
        credentials, headers = register(client)
        _, other = register(client)
        guest = {"X-Client-Id": uuid4().hex}
        word = {"text": "export-only", "meaning": "fixture", "example": "A fixture."}
        assert client.post("/api/words", headers=headers, json=word).status_code == 201
        assert client.post("/api/words", headers=guest, json=word).status_code == 201
        assert client.post("/api/practice", headers=headers, json={
            "kind": "interview", "title": "Export practice", "score": 4,
        }).status_code == 201
        response = client.get("/api/auth/me/export", headers=headers)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json()["profile"]["email"] == credentials["email"]
        assert [word["text"] for word in response.json()["words"]] == ["export-only"]
        assert response.json()["practice"][0]["title"] == "Export practice"
        assert client.get("/api/auth/me/export", headers=other).json()["words"] == []
        assert client.request("DELETE", "/api/auth/me", headers=headers, json={"password": "wrong"}).status_code == 403
        assert client.request("DELETE", "/api/auth/me", headers=headers, json={"password": credentials["password"]}).status_code == 204
        assert client.post("/api/words", headers=headers, json=word).status_code == 401
        assert len(client.get("/api/words", headers=guest).json()) == 1
        assert client.post("/api/auth/login", json=credentials).status_code == 401
        replacement = client.post("/api/auth/register", json=credentials).json()
        fresh = {"Authorization": f"Bearer {replacement['token']}"}
        assert client.get("/api/auth/me/export", headers=fresh).json()["practice"] == []
        assert client.get("/api/auth/me/export", headers=headers).status_code == 401


def test_email_links_are_one_use_and_reset_invalidates_all_old_tokens(monkeypatch):
    from app.api import account

    settings = get_settings()
    monkeypatch.setattr(settings, "resend_api_key", "fixture-key")
    monkeypatch.setattr(settings, "account_mail_from", "spoken@example.test")
    monkeypatch.setattr(settings, "account_public_origin", "https://spoken.example.test")
    messages = []
    monkeypatch.setattr(account, "send_account_mail", lambda email, kind, token: messages.append((email, kind, token)))
    with TestClient(app) as client:
        credentials, headers = register(client)
        assert client.post("/api/auth/email-verification", headers=headers).status_code == 202
        assert client.post("/api/auth/email-verification", headers=headers).status_code == 202
        assert len(messages) == 1
        verify_token = messages.pop()[2]
        assert client.post("/api/auth/email-verification/confirm", json={"token": verify_token}).status_code == 204
        assert client.post("/api/auth/email-verification/confirm", json={"token": verify_token}).status_code == 400
        assert client.get("/api/auth/me", headers=headers).json()["email_verified"] is True
        public = client.post("/api/auth/password-reset", json={"email": "unknown@example.test"})
        known = client.post("/api/auth/password-reset", json={"email": credentials["email"]})
        assert public.status_code == known.status_code == 202
        assert len(messages) == 1
        reset = {"token": messages.pop()[2], "password": "replacement-password"}
        assert client.post("/api/auth/password-reset/confirm", json=reset).status_code == 204
        assert client.post("/api/auth/password-reset/confirm", json=reset).status_code == 400
        assert client.get("/api/auth/me", headers=headers).status_code == 401
        assert client.get("/api/sessions", headers=headers).status_code == 401
        assert client.post("/api/auth/login", json={**credentials, "password": reset["password"]}).status_code == 200
