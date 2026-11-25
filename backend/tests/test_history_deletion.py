from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from os import close, unlink
from tempfile import mkstemp
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import URL, create_engine, event, select
from sqlalchemy.orm import Session

from app.api import rewards
from app.db import SessionLocal, engine
from app.main import app
from app.models.practice import PracticeRecord
from app.models.progress import LearningEvent
from app.models.request_receipt import RequestReceipt
from app.models.session import PracticeSession, SkillScore, Turn
from app.services import sessions, users


@pytest.fixture
def client():
    with TestClient(app, headers={"X-Client-Id": uuid4().hex}) as browser:
        yield browser


def conversation(key, *, scenario="airport", score=96):
    return {
        "scenario_id": scenario, "client_session_id": key, "overall": score,
        "messages": [{"role": "user", "content": "Yesterday I go to the airport."}],
        "scores": [{"key": "grammar", "label_en": "Grammar", "label_zh": "语法", "score": score}]
                  if score is not None else [],
        "corrections": [{"original": "go", "suggestion": "went", "note": "过去式",
                         "turn_index": 0, "category": "tense"}],
    }


def delete(client, resource, record):
    return client.delete(f"/api/{resource}/{record['id']}", params={"created_at": record["created_at"]})


@contextmanager
def capture_history_reads():
    reads = []
    history_connections = set()
    committed = False

    def mark_commit(connection):
        nonlocal committed
        if connection in history_connections:
            committed = True

    def collect_read(connection, _cursor, statement, _parameters, _context, _executemany):
        query = " ".join(statement.lower().split())
        if query.startswith("select ") and any(f" from {table} " in query for table in ("sessions", "turns", "scores")):
            history_connections.add(connection)
            reads.append((query, committed))

    event.listen(engine, "commit", mark_commit)
    event.listen(engine, "before_cursor_execute", collect_read)
    try:
        yield reads
    finally:
        event.remove(engine, "before_cursor_execute", collect_read)
        event.remove(engine, "commit", mark_commit)


def test_delete_conversation_removes_history_coaching_score_and_activity(client):
    original = conversation("airport-report", score=None)
    unscored = client.post("/api/sessions", json=original).json()
    graded = client.post("/api/sessions", json=conversation("airport-report")).json()
    assert graded["id"] == unscored["id"] and graded["overall"] == 96
    remaining = client.post("/api/sessions", json=conversation("other-report", score=58)).json()
    assert client.post("/api/words", json={"text": "went to the airport"}).is_success
    assert client.get("/api/progress/coaching").json()["examples"]
    assert client.get("/api/stats/insights").json()["skills"][0]["avg"] == 77

    path = f"/api/sessions/{graded['id']}"
    stranger = {"X-Client-Id": uuid4().hex}
    params = {"created_at": graded["created_at"]}
    assert client.delete(path, params=params, headers=stranger).status_code == 404
    assert client.delete(path).status_code == 422
    assert client.delete(path, params={"created_at": "2000-01-01T00:00:00Z"}).status_code == 409
    assert client.get(path).is_success
    assert delete(client, "sessions", graded).status_code == 204
    assert client.get(path).status_code == 404
    assert delete(client, "sessions", graded).status_code == 204
    assert client.delete(path, params=params, headers=stranger).status_code == 404
    assert [row["id"] for row in client.get("/api/sessions").json()] == [remaining["id"]]
    progress = client.get("/api/progress/sessions").json()
    assert progress["latest"]["id"] == remaining["id"]
    assert progress["insights"]["skills"][0]["avg"] == 58
    assert progress["insights"]["skills"][0]["samples"] == 1
    assert {row["session_id"] for row in client.get("/api/progress/coaching").json()["examples"]} == {remaining["id"]}
    for retry in (original, conversation("airport-report")):
        result = client.post("/api/sessions", json=retry)
        assert result.status_code == 409 and result.json()["detail"]["code"] == "practice_record_deleted"
    with SessionLocal() as db:
        assert db.get(PracticeSession, graded["id"]) is None
        assert db.scalar(select(Turn.id).where(Turn.session_id == graded["id"])) is None
        assert db.scalar(select(SkillScore.id).where(SkillScore.session_id == graded["id"])) is None
    assert delete(client, "sessions", remaining).status_code == 204
    assert client.get("/api/progress/sessions").json()["sessions"] == []
    assert client.get("/api/progress/coaching").json()["examples"] == []
    stats = client.get("/api/stats").json()
    assert stats["total_sessions"] == stats["today_count"] == 0 and stats["xp"] == 5
    assert {"first_conversation", "conversation_90"} <= set(stats["earned_badges"])
    assert client.get("/api/words").json()[0]["text"] == "went to the airport"


@pytest.mark.parametrize("kind", ["interview", "pronunciation"])
def test_delete_standalone_record_scrubs_retry_and_protects_recycled_id(client, kind):
    owner = client.headers["X-Client-Id"]
    body = {"kind": kind, "score": 4, "title": "Private title", "detail": "Private answer",
            "client_request_id": "standalone-report"}
    saved = client.post("/api/practice", json=body).json()
    path = f"/api/practice/{saved['id']}"
    assert client.delete(path, params={"created_at": saved["created_at"]},
                         headers={"X-Client-Id": uuid4().hex}).status_code == 404
    stored = datetime.fromisoformat(saved["created_at"])
    stale = {**saved, "created_at": (stored + timedelta(microseconds=1)).isoformat()}
    assert delete(client, "practice", stale).status_code == 409
    # Offset conversion preserves the exact original microseconds.
    offset = stored.replace(tzinfo=timezone.utc).astimezone(timezone(timedelta(hours=8)))
    assert delete(client, "practice", {**saved, "created_at": offset.isoformat()}).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get("/api/practice").json() == []
    assert client.get("/api/stats").json()["total_practice"] == 0
    with SessionLocal() as db:
        receipt = db.get(RequestReceipt, (owner, "practice", body["client_request_id"]))
        assert "Private title" not in receipt.response_metadata
        assert "score" not in receipt.response_metadata
        assert db.scalar(select(LearningEvent.score).where(LearningEvent.event_key == receipt.event_key)) is None
        db.add(PracticeRecord(id=saved["id"], client_id=owner, kind=kind, title="Later record",
                              created_at=stored + timedelta(seconds=1)))
        db.commit()

    result = client.post("/api/practice", json=body)
    assert result.status_code == 409 and result.json()["detail"]["code"] == "practice_record_deleted"
    assert "Private title" not in result.text
    assert delete(client, "practice", saved).status_code == 204
    assert client.get(path, params={"created_at": saved["created_at"]}).status_code == 404
    new_identity = (stored + timedelta(seconds=1)).isoformat()
    assert client.get(path, params={"created_at": new_identity}).json()["title"] == "Later record"
    assert client.get(path).json()["title"] == "Later record"
    assert client.delete(path, params={"created_at": "2000-01-01T00:00:00Z"}).status_code == 409


def test_session_detail_with_creation_time_does_not_open_a_reused_id(client):
    saved = client.post("/api/sessions", json=conversation("deleted-link")).json()
    assert delete(client, "sessions", saved).status_code == 204
    created_at = datetime.fromisoformat(saved["created_at"]) + timedelta(seconds=1)
    with SessionLocal() as db:
        db.add(PracticeSession(id=saved["id"], client_id=client.headers["X-Client-Id"],
                               scenario_id="hotel", overall=90, created_at=created_at))
        db.commit()
    path = f"/api/sessions/{saved['id']}"
    assert client.get(path, params={"created_at": saved["created_at"]}).status_code == 404
    assert client.get(path, params={"created_at": created_at.isoformat()}).json()["scenario_id"] == "hotel"
    assert client.get(path, params={"created_at": "0001-01-01T00:00:00+08:00"}).status_code == 404


def test_session_detail_reads_session_and_children_in_one_snapshot(client):
    saved = client.post("/api/sessions", json=conversation("detail-snapshot")).json()
    created_at = datetime.fromisoformat(saved["created_at"]).replace(tzinfo=timezone.utc)
    offset = created_at.astimezone(timezone(timedelta(hours=8)))
    with capture_history_reads() as reads:
        response = client.get(f"/api/sessions/{saved['id']}", params={"created_at": offset.isoformat()})

    assert response.status_code == 200
    assert response.json() == saved
    assert len(reads) == 1  # No second read may observe a later record at this numeric ID.


def test_progress_reads_coherent_scores_if_a_same_owner_session_id_is_reused():
    fd, path = mkstemp(prefix="spoken_progress_", suffix=".db")
    close(fd)
    database = create_engine(URL.create("sqlite", database=path))

    def record(scene, score, created_at):
        return PracticeSession(id=1, client_id="same-owner", scenario_id=scene, overall=score,
                               created_at=created_at, scores=[SkillScore(
                                   key="grammar", label_en="Grammar", label_zh="语法", score=score)])

    try:
        with database.begin() as connection:
            connection.exec_driver_sql("PRAGMA journal_mode=WAL")
            for table in (PracticeSession.__table__, SkillScore.__table__, Turn.__table__):
                table.create(connection)
        created_at = datetime(2026, 11, 25, 8)
        with Session(database) as writer, writer.begin():
            writer.add(record("airport", 96, created_at))

        def replace_record(*_args):
            with Session(database) as writer, writer.begin():
                writer.delete(writer.get(PracticeSession, 1))
                writer.flush()
                writer.add(record("hotel", 58, created_at + timedelta(seconds=1)))

        with database.connect() as connection, Session(connection) as reader:
            # Commit the delete and replacement after the reader starts its first SQL statement.
            event.listen(connection, "after_cursor_execute", replace_record, once=True)
            history = sessions.progress_sessions(reader, "same-owner")
            replacement = sessions.progress_sessions(reader, "same-owner")

        assert [(row.scenario_id, row.overall) for row in history["sessions"]] == [("airport", 96)]
        assert [score["score"] for score in history["latest"]["scores"]] == [96]
        assert history["insights"]["skills"][0]["avg"] == 96
        assert [(row.scenario_id, row.overall) for row in replacement["sessions"]] == [("hotel", 58)]
        assert [score["score"] for score in replacement["latest"]["scores"]] == [58]
    finally:
        database.dispose()
        unlink(path)


def test_session_save_retry_reads_history_before_releasing_the_owner_lock(client):
    payload = conversation("detail-receipt")
    saved = client.post("/api/sessions", json=payload).json()
    with capture_history_reads() as reads:
        retry = client.post("/api/sessions", json=payload)

    assert retry.status_code == 201 and retry.json() == saved
    assert reads and not any(after_commit for _, after_commit in reads)


def test_stale_correction_selection_cannot_change_a_replacement_session(client):
    payload = conversation("first-selection")
    saved = client.post("/api/sessions", json=payload).json()
    assert delete(client, "sessions", saved).status_code == 204
    fix = payload["corrections"][0]
    created_at = datetime.fromisoformat(saved["created_at"]) + timedelta(seconds=1)
    with SessionLocal() as db:
        db.add(PracticeSession(id=saved["id"], client_id=client.headers["X-Client-Id"],
                               scenario_id="airport", overall=90, created_at=created_at, corrections=[fix],
                               turns=[Turn(idx=0, role="user", content=payload["messages"][0]["content"])]))
        db.commit()

    path = f"/api/sessions/{saved['id']}"
    url = f"{path}/corrections/practice"
    selection = {**fix, "marked": True}
    assert client.patch(url, json={**selection, "created_at": saved["created_at"]}).status_code == 409
    assert client.patch(url, json=selection).status_code == 422
    assert client.get(path, params={"created_at": created_at.isoformat()}).json()["corrections"][0]["marked"] is False
    result = client.patch(url, json={**selection, "created_at": created_at.isoformat()})
    assert result.status_code == 200 and result.json()[0]["marked"] is True


def test_delete_and_late_scoring_serialize(client):
    record = client.post("/api/sessions", json=conversation("scoring-race", score=None)).json()
    start = Barrier(2, timeout=10)

    def remove():
        start.wait()
        return delete(client, "sessions", record)

    def score():
        start.wait()
        return client.post("/api/sessions", json=conversation("scoring-race"))

    with ThreadPoolExecutor(max_workers=2) as pool:
        deleting = pool.submit(remove)
        scoring = pool.submit(score)
        assert deleting.result().status_code == 204
        assert scoring.result().status_code in (201, 409)
    assert client.post("/api/sessions", json=conversation("scoring-race")).status_code == 409
    assert client.get("/api/sessions").json() == []
    assert client.get("/api/stats").json()["total_sessions"] == 0


def test_legacy_unkeyed_session_is_deletable_without_a_learning_event(client):
    with SessionLocal() as db:
        session = PracticeSession(client_id=client.headers["X-Client-Id"], scenario_id="airport",
                                  created_at=datetime(2026, 7, 1, 4, 10, 30))
        db.add(session)
        db.commit()
        record = {"id": session.id, "created_at": session.created_at.isoformat()}
    assert delete(client, "sessions", record).status_code == 204
    assert delete(client, "sessions", record).status_code == 204
    assert client.get(f"/api/sessions/{record['id']}").status_code == 404


def test_deleted_guest_history_stays_deleted_after_account_claim_and_export(client):
    session_body = conversation("claimed-session", score=None)
    practice_body = {"kind": "interview", "score": 4, "title": "Private rehearsal",
                     "client_request_id": "claimed-practice"}
    session = client.post("/api/sessions", json=session_body).json()
    practice = client.post("/api/practice", json=practice_body).json()
    assert delete(client, "sessions", session).status_code == 204
    assert delete(client, "practice", practice).status_code == 204
    with TestClient(app) as account:
        registered = account.post("/api/auth/register", json={
            "email": f"{uuid4().hex}@example.test", "password": "fixture-password",
        }).json()
        account.headers["Authorization"] = f"Bearer {registered['token']}"
        with SessionLocal() as db:
            assert users.claim_device_data(db, client.headers["X-Client-Id"], f"u:{registered['user']['id']}")
        for path, record, payload in (("sessions", session, session_body), ("practice", practice, practice_body)):
            result = account.post(f"/api/{path}", json=payload)
            assert result.status_code == 409 and result.json()["detail"]["code"] == "practice_record_deleted"
            assert delete(account, path, record).status_code == 204
            late_guest = client.post(f"/api/{path}", json=payload, headers={"X-Claim-Protocol": "1"})
            assert late_guest.status_code == 409 and late_guest.json()["detail"] == "guest_data_claimed"
        exported = account.get("/api/auth/me/export")
        assert exported.is_success
        document = exported.json()
        assert document["sessions"] == document["practice"] == document["learning_events"] == []


def test_deletion_preserves_claimed_rewards_and_earned_achievements(client, monkeypatch):
    now = datetime(2026, 11, 25, 11)
    monkeypatch.setattr(rewards, "utcnow", lambda: now)
    owner = client.headers["X-Client-Id"]
    scenes = ("cafe", "hotel", "doctor", "party", "airport", "airport", "airport")
    for index, scenario in enumerate(scenes):
        record = client.post("/api/sessions", json=conversation(f"scene-{index}", scenario=scenario)).json()
        with SessionLocal() as db:
            row = db.get(PracticeSession, record["id"])
            event = db.scalar(select(LearningEvent).where(LearningEvent.client_id == owner,
                                                        LearningEvent.source_id == row.id))
            row.created_at = event.occurred_at = now - timedelta(days=index)
            db.commit()
        if index in (0, 2):
            if index == 0:
                recent = {**record, "created_at": now.isoformat()}
            else:
                older = {**record, "created_at": (now - timedelta(days=index)).isoformat()}
    for _ in range(2):
        record = client.post("/api/practice", json={"kind": "pronunciation", "score": 91}).json()
        with SessionLocal() as db:
            row = db.get(PracticeRecord, record["id"])
            event = db.scalar(select(LearningEvent).where(LearningEvent.client_id == owner,
                LearningEvent.event_type == "practice", LearningEvent.source_id == row.id))
            row.created_at = event.occurred_at = now
            db.commit()

    path = "/api/practice-rewards"
    params = {"week_start": "2026-11-23"}
    assert client.post(path + "/goal").json()["coins"] == 15
    assert client.post(path + "/weekly/practice-days", params=params).json()["coins"] == 35
    assert client.post(path + "/items/pip-scarf").json()["coins"] == 15
    assert client.put(path + "/items/pip-scarf", json={"equipped": True}).is_success
    assert all(row["earned"] for row in client.get(path).json()["achievements"])
    assert delete(client, "sessions", recent).status_code == 204
    assert delete(client, "sessions", older).status_code == 204
    state = client.get(path).json()
    assert state["goal_count"] == 2 and state["goal_claimed"]
    weekly = next(row for row in state["weekly"]["goals"] if row["id"] == "practice-days")
    assert weekly["claimed"] and weekly["count"] == 2
    assert state["equipment"] == ["pip-scarf"]
    assert all(row["earned"] and row["count"] < row["target"] for row in state["achievements"])
    assert client.post(path + "/goal").json()["coins"] == 15
    assert client.post(path + "/weekly/practice-days", params=params).json()["coins"] == 15
