import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.mark.parametrize("headers", [{}, {"X-Client-Id": ""}, {"X-Client-Id": "   "}, {"X-Client-Id": "anon"}, {"X-Client-Id": "ANON"}])
def test_ambiguous_guest_identity_cannot_access_stored_data(headers):
    client = TestClient(app)
    for path in ["/api/words", "/api/sessions", "/api/practice", "/api/stats", "/api/stats/insights", "/api/sessions/1", "/api/practice/1"]:
        assert client.get(path, headers=headers).status_code == 400
    assert client.post("/api/words", headers=headers, json={"text":"private", "meaning":"private"}).status_code == 400
    assert client.post("/api/practice", headers=headers, json={"kind":"interview", "score":3}).status_code == 400
    assert client.delete("/api/words/1", headers=headers).status_code == 400


def test_real_guest_identity_still_has_isolated_stored_data():
    client = TestClient(app)
    response = client.post("/api/words", headers={"X-Client-Id":"real-guest-a"}, json={"text":"isolated", "meaning":"private"})
    assert response.status_code == 201
    word_id = response.json()["id"]
    assert client.delete(f"/api/words/{word_id}", headers={"X-Client-Id":"real-guest-b"}).status_code == 404
    assert any(word["id"] == word_id for word in client.get("/api/words", headers={"X-Client-Id":"real-guest-a"}).json())
