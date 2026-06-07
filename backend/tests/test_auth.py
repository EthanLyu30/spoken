from fastapi.testclient import TestClient

from app.main import app

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
