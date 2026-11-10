import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.main import app
from app.models.user import User
from app.api import auth as auth_api

client = TestClient(app)


def test_register_claims_device_data_and_logs_in():
    dev = {"X-Client-Id": "device-claim"}
    # A word saved anonymously on this device.
    w = client.post("/api/words", json={"text": "serendipity", "meaning": "m", "example": "e"}, headers=dev)
    assert w.status_code == 201

    r = client.post("/api/auth/register", json={"email": "claim@b.com", "password": "secret1"}, headers=dev)
    assert r.status_code == 201
    token = r.json()["token"]
    assert r.json()["user"]["email"] == "claim@b.com"

    # The claimed word is visible under the account (no device header).
    auth = {"Authorization": f"Bearer {token}"}
    words = client.get("/api/words", headers=auth).json()
    assert any(x["text"] == "serendipity" for x in words)


def test_me_returns_current_user():
    client.post("/api/auth/register", json={"email": "me@b.com", "password": "secret1"})
    token = client.post("/api/auth/login", json={"email": "me@b.com", "password": "secret1"}).json()["token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["email"] == "me@b.com"


def test_me_requires_valid_token():
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_duplicate_email_rejected():
    client.post("/api/auth/register", json={"email": "dup@b.com", "password": "secret1"})
    r = client.post("/api/auth/register", json={"email": "DUP@b.com", "password": "secret1"})
    assert r.status_code == 409  # email is normalised to lower-case


def test_login_wrong_password():
    client.post("/api/auth/register", json={"email": "pw@b.com", "password": "secret1"})
    assert client.post("/api/auth/login", json={"email": "pw@b.com", "password": "nope"}).status_code == 401


def test_account_data_is_isolated_from_devices():
    reg = client.post("/api/auth/register", json={"email": "iso@b.com", "password": "secret1"})
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    client.post("/api/words", json={"text": "accountword", "meaning": "m", "example": "e"}, headers=auth)

    # A different anonymous device must not see the account's word.
    other = client.get("/api/words", headers={"X-Client-Id": "some-other-device"}).json()
    assert not any(x["text"] == "accountword" for x in other)


def test_register_validates_input():
    assert client.post("/api/auth/register", json={"email": "not-an-email", "password": "secret1"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "short@b.com", "password": "123"}).status_code == 422


def test_register_sets_default_display_name_from_email():
    r = client.post("/api/auth/register", json={"email": "alice@b.com", "password": "secret1"})
    assert r.status_code == 201 and r.json()["user"]["display_name"] == "alice"


def test_update_profile_name_and_avatar():
    reg = client.post("/api/auth/register", json={"email": "edit@b.com", "password": "secret1"})
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    avatar = "data:image/png;base64,iVBORw0KGgo="
    p = client.patch("/api/auth/me", json={"display_name": "  Pip Fan  ", "avatar_url": avatar}, headers=auth)
    assert p.status_code == 200
    assert p.json()["display_name"] == "Pip Fan"  # trimmed
    assert p.json()["avatar_url"] == avatar
    # Persisted: a fresh /me reflects the edit.
    assert client.get("/api/auth/me", headers=auth).json()["display_name"] == "Pip Fan"


def test_update_profile_rejects_bad_avatar_and_requires_auth():
    reg = client.post("/api/auth/register", json={"email": "bad@b.com", "password": "secret1"})
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    assert client.patch("/api/auth/me", json={"avatar_url": "http://evil/x.png"}, headers=auth).status_code == 422
    assert client.patch("/api/auth/me", json={"display_name": "x"}).status_code == 401


def test_register_claims_all_saved_guest_progress():
    dev = {"X-Client-Id": "device-claim-all"}
    session = client.post(
        "/api/sessions",
        headers=dev,
        json={
            "scenario_id": "cafe",
            "client_session_id": "guest-session-all",
            "messages": [{"role": "user", "content": "A latte, please."}],
            "overall": 80,
        },
    )
    assert session.status_code == 201
    practice = client.post(
        "/api/practice",
        headers=dev,
        json={"kind": "interview", "score": 5, "title": "Guest interview"},
    )
    assert practice.status_code == 201
    word = client.post(
        "/api/words",
        headers=dev,
        json={"text": "guest-word", "meaning": "m", "example": "e"},
    )
    assert word.status_code == 201
    assert client.post(
        f"/api/words/{word.json()['id']}/review",
        headers=dev,
        json={"remembered": True},
    ).status_code == 200

    reg = client.post(
        "/api/auth/register",
        json={"email": "claim-all@b.com", "password": "secret1"},
        headers=dev,
    )
    assert reg.status_code == 201
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}

    sessions = client.get("/api/sessions", headers=auth).json()
    assert any(row["id"] == session.json()["id"] for row in sessions)
    practice_rows = client.get("/api/practice?kind=interview", headers=auth).json()
    assert any(row["id"] == practice.json()["id"] for row in practice_rows)
    words = client.get("/api/words", headers=auth).json()
    assert any(row["id"] == word.json()["id"] for row in words)
    stats = client.get("/api/stats", headers=auth).json()
    assert stats["total_sessions"] >= 1
    assert stats["total_practice"] >= 1
    assert stats["words_count"] >= 1

    # The guest identity no longer sees the claimed records.
    assert not any(
        row["id"] == session.json()["id"]
        for row in client.get("/api/sessions", headers=dev).json()
    )


def test_register_rolls_back_account_when_claim_fails(monkeypatch):
    email = "claim-rollback@b.com"
    device = {"X-Client-Id": "device-claim-rollback"}

    def fail_claim(*args, **kwargs):
        raise RuntimeError("claim unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(auth_api.repo, "claim_device_data", fail_claim)
        with pytest.raises(RuntimeError, match="claim unavailable"):
            client.post("/api/auth/register", json={"email": email, "password": "secret1"}, headers=device)

    with SessionLocal() as db:
        assert db.scalar(select(User).where(User.email == email)) is None

    # The rolled-back email can be registered again instead of returning 409.
    retry = client.post("/api/auth/register", json={"email": email, "password": "secret1"}, headers=device)
    assert retry.status_code == 201


def test_guest_claim_blocks_late_guest_writes_and_allows_owner_retry():
    dev = {"X-Client-Id": "late-write-guest"}
    assert client.post("/api/words", json={"text": "early", "meaning": "m", "example": "e"}, headers=dev).status_code == 201
    reg = client.post("/api/auth/register", json={"email": "late-write@b.com", "password": "secret1"}, headers=dev)
    assert reg.status_code == 201
    token = reg.json()["token"]
    auth = {"Authorization": f"Bearer {token}"}

    # The old guest id is now claimed. A late anonymous write must not recreate
    # data under the guest owner.
    late = client.post("/api/words", json={"text": "late", "meaning": "m", "example": "e"}, headers=dev)
    assert late.status_code == 409
    assert late.json()["detail"] == "guest_data_claimed"

    # A retry carrying the owning account and the original guest id is allowed
    # and lands under the account.
    retry = client.post(
        "/api/words",
        json={"text": "late", "meaning": "m", "example": "e"},
        headers={**dev, **auth},
    )
    assert retry.status_code == 201
    words = client.get("/api/words", headers=auth).json()
    assert any(x["text"] == "late" for x in words)
    old = client.get("/api/words", headers=dev).json()
    assert not any(x["text"] in ("early", "late") for x in old)


def test_guest_claim_status_is_scoped_to_owning_account():
    dev = {"X-Client-Id": "claim-status-guest"}
    reg = client.post("/api/auth/register", json={"email": "claim-status@b.com", "password": "secret1"}, headers=dev)
    assert reg.status_code == 201
    auth = {"Authorization": f"Bearer {reg.json()['token']}"}
    mine = client.get("/api/auth/guest-claim", params={"guest_id": "claim-status-guest"}, headers=auth)
    assert mine.status_code == 200 and mine.json() == {"claimed": True, "mine": True}

    other = client.post("/api/auth/register", json={"email": "claim-other@b.com", "password": "secret1"})
    other_auth = {"Authorization": f"Bearer {other.json()['token']}"}
    status = client.get("/api/auth/guest-claim", params={"guest_id": "claim-status-guest"}, headers=other_auth)
    assert status.status_code == 200 and status.json() == {"claimed": True, "mine": False}


def test_second_account_cannot_claim_an_already_claimed_guest():
    dev = {"X-Client-Id": "one-owner-guest"}
    first = client.post("/api/auth/register", json={"email": "owner-one@b.com", "password": "secret1"}, headers=dev)
    assert first.status_code == 201
    second = client.post("/api/auth/register", json={"email": "owner-two@b.com", "password": "secret1"}, headers=dev)
    assert second.status_code == 409
    assert second.json()["detail"] == "guest_data_claimed"
    with SessionLocal() as db:
        assert db.scalar(select(User).where(User.email == "owner-two@b.com")) is None


def test_authenticated_account_write_with_claimed_device_id_is_allowed():
    guest = {"X-Client-Id": "cross-account-device"}
    first = client.post("/api/auth/register", json={"email": "device-owner@b.com", "password": "secret1"}, headers=guest)
    assert first.status_code == 201
    owner_auth = {"Authorization": f"Bearer {first.json()['token']}"}

    other = client.post("/api/auth/register", json={"email": "device-other@b.com", "password": "secret1"})
    assert other.status_code == 201
    other_auth = {"Authorization": f"Bearer {other.json()['token']}"}

    # An authenticated account may still use a browser that carries a device id
    # claimed by another account; only anonymous guest writes are migration-bound.
    written = client.post(
        "/api/words",
        json={"text": "account-b-word", "meaning": "m", "example": "e"},
        headers={**guest, **other_auth},
    )
    assert written.status_code == 201
    assert any(x["text"] == "account-b-word" for x in client.get("/api/words", headers=other_auth).json())
    assert not any(x["text"] == "account-b-word" for x in client.get("/api/words", headers=owner_auth).json())
