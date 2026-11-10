"""A response lost after commit must not repeat practice or SRS effects."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.main import app
from app.models.progress import LearningEvent
from app.models.word import WordEntry
from app.services import practice, users, words


@pytest.fixture
def client():
    return TestClient(app, headers={"X-Client-Id": "request-" + uuid4().hex})


def save(client, key="save-1", **changes):
    return client.post("/api/practice", json={"kind": "interview", "score": 5,
        "title": "Interview", "detail": '{"private":"answer"}',
        "client_request_id": key, **changes})


def word(client, text="hello"):
    result = client.post("/api/words", json={"text": text, "meaning": "meaning", "example": "example"})
    assert result.status_code == 201
    return result.json()["id"]


def test_practice_response_loss_replays_metadata_without_history_or_xp(client):
    original = save(client)
    retry = save(client)
    assert original.status_code == retry.status_code == 201
    assert retry.json() == original.json()
    assert len(client.get("/api/practice").json()) == 1
    stats = client.get("/api/stats").json()
    assert stats["total_practice"] == 1 and stats["xp"] == 15


@pytest.mark.parametrize("changes", [{"score": 4}, {"kind": "pronunciation"},
    {"title": "Changed"}, {"detail": "changed answer"}])
def test_practice_conflicting_key_is_409_without_credit(client, changes):
    assert save(client).status_code == 201
    assert save(client, **changes).status_code == 409
    assert client.get("/api/stats").json()["total_practice"] == 1


def test_practice_pruned_retry_does_not_restore_answer_or_credit(client):
    original = save(client).json()
    with SessionLocal() as db:
        practice.prune_records(db, client.headers["X-Client-Id"], keep=0)
    assert save(client).json() == original
    assert client.get("/api/practice").json() == []
    assert client.get(f"/api/practice/{original['id']}").status_code == 404
    assert client.get("/api/stats").json()["xp"] == 15


def test_review_response_loss_does_not_advance_srs_or_add_journal_event(client):
    word_id = word(client)
    body = {"remembered": True, "client_request_id": "review-1"}
    original = client.post(f"/api/words/{word_id}/review", json=body)
    retry = client.post(f"/api/words/{word_id}/review", json=body)
    assert original.status_code == retry.status_code == 200
    assert retry.json() == original.json()
    assert retry.json()["box"] == 1
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LearningEvent).where(
            LearningEvent.client_id == client.headers["X-Client-Id"],
            LearningEvent.event_type == "word_reviewed")) == 1


def test_review_conflicting_remembered_or_word_is_409(client):
    first, second = word(client), word(client, "goodbye")
    path = f"/api/words/{first}/review"
    assert client.post(path, json={"remembered": True, "client_request_id": "review"}).status_code == 200
    assert client.post(path, json={"remembered": False, "client_request_id": "review"}).status_code == 409
    assert client.post(f"/api/words/{second}/review", json={"remembered": True,
        "client_request_id": "review"}).status_code == 409
    listed = {row["id"]: row for row in client.get("/api/words").json()}
    assert listed[first]["box"] == 1 and listed[second]["box"] == 0


@pytest.mark.parametrize("key", ["", "x" * 81])
def test_request_key_validation_at_both_write_boundaries(client, key):
    assert save(client, key).status_code == 422
    word_id = word(client)
    assert client.post(f"/api/words/{word_id}/review", json={"remembered": True,
        "client_request_id": key}).status_code == 422


def test_legacy_requests_still_create_distinct_practices_and_reviews(client):
    for _ in range(2):
        assert client.post("/api/practice", json={"kind": "interview", "score": 5}).status_code == 201
    word_id = word(client)
    for expected in [1, 2]:
        result = client.post(f"/api/words/{word_id}/review", json={"remembered": True})
        assert result.status_code == 200 and result.json()["box"] == expected
    assert client.get("/api/stats").json()["total_practice"] == 2


def test_keys_are_owner_and_operation_scoped(client):
    other = TestClient(app, headers={"X-Client-Id": "other-" + uuid4().hex})
    first, second = save(client).json(), save(other).json()
    assert first["id"] != second["id"]
    word_id = word(client)
    assert client.post(f"/api/words/{word_id}/review", json={"remembered": True,
        "client_request_id": "save-1"}).status_code == 200


def test_concurrent_lost_response_retries_have_one_practice_and_one_review(client):
    word_id = word(client)
    def retry(_):
        result = save(client)
        review = client.post(f"/api/words/{word_id}/review", json={"remembered": True,
            "client_request_id": "review"})
        return result.status_code, result.json()["id"], review.status_code, review.json()["box"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(retry, range(8)))
    assert len(set(results)) == 1
    assert results[0][0] == 201 and results[0][2:] == (200, 1)
    assert client.get("/api/stats").json()["total_practice"] == 1


def test_claim_moves_pruned_practice_and_review_receipts(client):
    original = save(client).json()
    word_id = word(client)
    body = {"remembered": True, "client_request_id": "review"}
    reviewed = client.post(f"/api/words/{word_id}/review", json=body).json()
    account_id = "u:" + uuid4().hex
    with SessionLocal() as db:
        practice.prune_records(db, client.headers["X-Client-Id"], keep=0)
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
    from app.core.deps import get_client_id
    app.dependency_overrides[get_client_id] = lambda: account_id
    try:
        assert save(client).json() == original
        assert client.post(f"/api/words/{word_id}/review", json=body).json() == reviewed
        assert client.get("/api/stats").json()["total_practice"] == 1
    finally:
        app.dependency_overrides.pop(get_client_id, None)


def test_claim_collision_preserves_account_receipt_and_single_practice_credit(client):
    from app.core.deps import get_client_id
    account_id = "u:" + uuid4().hex
    app.dependency_overrides[get_client_id] = lambda: account_id
    try:
        original = save(client, score=4).json()
    finally:
        app.dependency_overrides.pop(get_client_id, None)
    assert save(client).status_code == 201
    with SessionLocal() as db:
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
    app.dependency_overrides[get_client_id] = lambda: account_id
    try:
        assert save(client, score=4).json() == original
        assert save(client).status_code == 409
        assert client.get("/api/stats").json()["total_practice"] == 1
        assert len(client.get("/api/practice").json()) == 1
    finally:
        app.dependency_overrides.pop(get_client_id, None)


def test_review_key_cannot_replay_onto_recycled_word_id(client):
    first = word(client)
    body = {"remembered": True, "client_request_id": "review"}
    assert client.post(f"/api/words/{first}/review", json=body).status_code == 200
    assert client.delete(f"/api/words/{first}").status_code == 204
    # Deliberately recycle the primary key, as SQLite may do after a delete.
    with SessionLocal() as db:
        db.add(WordEntry(id=first, client_id=client.headers["X-Client-Id"], text="replacement"))
        db.commit()
    assert client.post(f"/api/words/{first}/review", json=body).status_code == 409
    assert client.get("/api/words").json()[0]["box"] == 0


def test_old_review_retry_returns_current_schedule_without_repeating_review(client):
    word_id = word(client)
    path = f"/api/words/{word_id}/review"
    assert client.post(path, json={"remembered": True, "client_request_id": "first"}).json()["box"] == 1
    current = client.post(path, json={"remembered": True, "client_request_id": "second"}).json()
    assert current["box"] == 2
    assert client.post(path, json={"remembered": True, "client_request_id": "first"}).json() == current
    assert client.get("/api/words").json()[0]["box"] == 2
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(LearningEvent).where(
            LearningEvent.client_id == client.headers["X-Client-Id"],
            LearningEvent.event_type == "word_reviewed")) == 2


def test_claim_collision_deduplicates_review_events_and_preserves_account_schedule(client):
    account = TestClient(app)
    registration = account.post("/api/auth/register", json={
        "email": f"{uuid4().hex}@example.test", "password": "fixture-password",
    }).json()
    account_id = f"u:{registration['user']['id']}"
    account.headers["Authorization"] = f"Bearer {registration['token']}"
    account_word = word(account)
    account_review = account.post(f"/api/words/{account_word}/review",
        json={"remembered": True, "client_request_id": "review"}).json()
    guest_word = word(client)
    assert client.post(f"/api/words/{guest_word}/review",
        json={"remembered": True, "client_request_id": "review"}).status_code == 200
    with SessionLocal() as db:
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
        users.claim_device_data(db, client.headers["X-Client-Id"], account_id)
        assert db.scalar(select(func.count()).select_from(LearningEvent).where(
            LearningEvent.client_id == account_id, LearningEvent.event_type == "word_reviewed")) == 1
        assert words.get_word(db, account_id, account_word).box == 1
    assert account.post(f"/api/words/{account_word}/review",
        json={"remembered": True, "client_request_id": "review"}).json() == account_review
    assert account.post(f"/api/words/{guest_word}/review",
        json={"remembered": True, "client_request_id": "review"}).status_code == 409


def test_receipts_roll_back_with_failed_awards_and_allow_retry(client, monkeypatch):
    from app.services import progress
    from app.models.request_receipt import RequestReceipt

    owner = client.headers["X-Client-Id"]
    word_id = word(client)
    def fail(*args, **kwargs):
        raise RuntimeError("award unavailable")
    with monkeypatch.context() as patch:
        patch.setattr(progress, "stats_and_awards", fail)
        with pytest.raises(RuntimeError, match="award unavailable"):
            save(client)
        with pytest.raises(RuntimeError, match="award unavailable"):
            client.post(f"/api/words/{word_id}/review",
                json={"remembered": True, "client_request_id": "review"})
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(RequestReceipt).where(
            RequestReceipt.client_id == owner)) == 0
        assert words.get_word(db, owner, word_id).box == 0
    assert save(client).status_code == 201
    assert client.post(f"/api/words/{word_id}/review",
        json={"remembered": True, "client_request_id": "review"}).json()["box"] == 1


def test_additive_receipt_table_install_keeps_legacy_records(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect
    from app import db as database
    from app.models.practice import PracticeRecord

    engine = create_engine("sqlite:///" + str(tmp_path / "upgrade.db"))
    PracticeRecord.__table__.create(engine)
    with engine.begin() as conn:
        conn.execute(PracticeRecord.__table__.insert().values(client_id="legacy", kind="interview",
            score=5, title="Keep", detail="private original"))
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "_url", str(engine.url))
    database.init_db()
    database.init_db()
    assert "request_receipts" in inspect(engine).get_table_names()
    with engine.connect() as conn:
        assert conn.scalar(select(PracticeRecord.detail)) == "private original"
    engine.dispose()
