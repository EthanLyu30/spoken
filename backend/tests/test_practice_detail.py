import uuid
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_practice_detail_is_available_only_to_its_owner():
    owner = {"X-Client-Id": "qa-" + uuid.uuid4().hex}
    saved = client.post("/api/practice", headers=owner, json={"kind": "interview", "score": 5, "title": "Exercise", "detail": '{"mode":"practice","results":[]}'})
    assert saved.status_code == 201
    record_id = saved.json()["id"]
    own = client.get(f"/api/practice/{record_id}", headers=owner)
    assert own.status_code == 200
    assert own.json()["detail"].startswith('{"mode"')
    assert client.get(f"/api/practice/{record_id}", headers={"X-Client-Id": "qa-other-" + uuid.uuid4().hex}).status_code == 404
    assert client.get("/api/practice/999999999", headers=owner).status_code == 404


def test_full_four_question_review_fits_in_practice_storage():
    response = client.post("/api/practice", headers={"X-Client-Id": "qa-" + uuid.uuid4().hex}, json={"kind": "interview", "score": 5, "detail": "x" * 24000})
    assert response.status_code == 201
