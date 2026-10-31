"""Permanent progress must survive bounded detail storage and owner changes."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal
from app.main import app
from app.models.practice import PracticeRecord
from app.models.session import PracticeSession
from app.models.word import WordEntry
from app.schemas.practice import PracticeCreate
from app.schemas.session import SaveSessionRequest
from app.services import practice, sessions, users, words


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def owner():
    return "durable-" + uuid4().hex


def payload(key=None, score=95, scenario="cafe"):
    return SaveSessionRequest(scenario_id=scenario, client_session_id=key,
                              messages=[{"role": "user", "content": "Private answer"}],
                              overall=score, summary="Private feedback")


def test_lifetime_progress_survives_actual_detail_pruning(db, owner):
    for i in range(10):
        sessions.create_session(db, owner, payload(str(i), scenario=f"scenario-{i % 5}"))
    for _ in range(3):
        practice.create_record(db, owner, PracticeCreate(kind="interview", score=5))
    practice.create_record(db, owner, PracticeCreate(kind="pronunciation", score=91))
    sessions.prune_sessions(db, owner, keep=1)
    practice.prune_records(db, owner, keep=1)
    stats = practice.compute_stats(db, owner)
    assert stats["total_sessions"] == 10
    assert stats["total_practice"] == 4
    assert stats["level"] == 2 and stats["xp"] == 210
    assert {"first_conversation", "conversations_10", "interviews_3", "pronunciation_90",
            "conversation_90", "scenarios_5"} <= set(stats["earned_badges"])
    assert len(sessions.list_sessions(db, owner)) == 1
    assert len(practice.list_records(db, owner)) == 1


def test_recollection_keeps_lifetime_word_xp_and_badges(db, owner):
    for i in range(50):
        entry = words.create_word(db, owner, f"word-{i}", "", "", "")
        if i < 10:
            words.review_word(db, entry, remembered=False)
        words.delete_word(db, entry)
    entry = words.create_word(db, owner, "word-0", "", "", "")
    words.delete_word(db, entry)
    stats = practice.compute_stats(db, owner)
    assert stats["words_count"] == 0
    assert stats["level"] == 2 and stats["xp"] == 0
    assert stats["today_count"] == 0
    assert stats["streak_days"] == 1
    assert {"words_10", "words_50", "reviewed_words_10"} <= set(stats["earned_badges"])


def test_expired_duplicate_returns_original_receipt_without_new_detail(db, owner):
    client = TestClient(app, headers={"X-Client-Id": owner})
    original = client.post("/api/sessions", json=payload("stable").model_dump()).json()
    sessions.prune_sessions(db, owner, keep=0)
    retry = client.post("/api/sessions", json=payload("stable", 12, "changed").model_dump())
    assert retry.status_code == 201
    assert retry.json() == {k: original[k] for k in ("id", "scenario_id", "overall", "created_at")} | {
        "detail_available": False}
    assert client.get("/api/sessions").json() == []
    assert client.get(f"/api/sessions/{original['id']}").status_code == 404
    assert client.get("/api/stats").json()["total_sessions"] == 1


def test_timezone_contract_and_invalid_fallback(owner):
    client = TestClient(app, headers={"X-Client-Id": owner})
    for zone, expected in [("Asia/Shanghai", "Asia/Shanghai"), ("not/a-zone", "UTC"),
                           ("../../UTC", "UTC")]:
        result = client.get("/api/stats", headers={"X-Timezone": zone}).json()
        assert result["timezone"] == expected
        assert len(result["local_date"]) == 10
    assert client.get("/api/stats").json()["timezone"] == "UTC"


def test_concurrent_saves_keep_one_receipt_and_one_award(owner):
    def save(_):
        with SessionLocal() as db:
            return sessions.create_session(db, owner, payload("shared")).id
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(save, range(8)))
    assert len(set(ids)) == 1
    with SessionLocal() as db:
        sessions.prune_sessions(db, owner, keep=0)
        assert practice.compute_stats(db, owner)["total_sessions"] == 1


def test_claim_transfers_pruned_receipt_and_badges_and_isolates_guest(db, owner):
    account = "u:" + uuid4().hex
    original = sessions.create_session(db, owner, payload("claimed"))
    original_id = original.id
    sessions.prune_sessions(db, owner, keep=0)
    users.claim_device_data(db, owner, account)
    assert practice.compute_stats(db, owner)["total_sessions"] == 0
    assert practice.compute_stats(db, account)["total_sessions"] == 1
    assert "first_conversation" in practice.compute_stats(db, account)["earned_badges"]
    retry = sessions.create_session(db, account, payload("claimed", 1))
    assert retry.id == original_id and retry.overall == 95
    assert practice.compute_stats(db, account)["total_sessions"] == 1


def test_backfill_is_versioned_uses_supplied_engine_and_keeps_unknown_review_evidence(tmp_path):
    from app.services import progress

    engine = create_engine("sqlite:///" + str(tmp_path / "legacy.db"))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(PracticeSession(client_id="legacy", scenario_id="old", overall=92,
                               created_at=datetime(2020, 1, 1)))
        db.add(WordEntry(client_id="legacy", text="forgotten", box=0,
                         created_at=datetime(2020, 1, 1), last_reviewed=datetime(2020, 1, 2)))
        for i in range(10):
            db.add(WordEntry(client_id="legacy", text=f"unknown-{i}", box=1,
                             created_at=datetime(2020, 1, 1)))
        db.commit()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: progress.backfill_progress(engine), range(2)))
    progress.backfill_progress(engine)
    with Session(engine) as db:
        stats = practice.compute_stats(db, "legacy")
        assert stats["total_sessions"] == 1
        assert stats["today_count"] == 0 and stats["streak_days"] == 0
        assert "reviewed_words_10" in stats["earned_badges"]
        assert db.scalar(select(func.count()).select_from(progress.LearningEvent)) == 23
        # Version completion prevents reimport of deleted history or reused source IDs.
        db.add(PracticeSession(client_id="legacy", scenario_id="late", overall=10))
        db.commit()
    progress.backfill_progress(engine)
    with Session(engine) as db:
        assert practice.compute_stats(db, "legacy")["total_sessions"] == 1
    engine.dispose()


@pytest.mark.parametrize("zone,now,events,today_count,streak", [
    ("Asia/Shanghai", datetime(2026, 10, 31, 16, 0),
     [datetime(2026, 10, 31, 15, 59), datetime(2026, 10, 31, 16, 0)], 1, 2),
    ("America/New_York", datetime(2026, 11, 1, 7, 0),
     [datetime(2026, 11, 1, 3, 59), datetime(2026, 11, 1, 5, 30), datetime(2026, 11, 1, 6, 30)], 2, 2),
    ("America/New_York", datetime(2026, 3, 8, 7, 1),
     [datetime(2026, 3, 8, 4, 59), datetime(2026, 3, 8, 6, 59), datetime(2026, 3, 8, 7, 0)], 2, 2),
])
def test_local_days_handle_midnight_and_dst(db, owner, monkeypatch, zone, now, events, today_count, streak):
    from app.services import progress

    monkeypatch.setattr(progress, "utcnow", lambda: now)
    for timestamp in events:
        db.add(progress.LearningEvent(event_key=uuid4().hex, client_id=owner,
                                     event_type="practice", occurred_at=timestamp))
    db.commit()
    stats = practice.compute_stats(db, owner, zone)
    assert stats["today_count"] == today_count
    assert stats["streak_days"] == streak


def test_historical_review_streak_award_survives_timezone_change(db, owner, monkeypatch):
    from app.services import progress

    monkeypatch.setattr(progress, "utcnow", lambda: datetime(2026, 10, 31, 12))
    for i in range(7):
        db.add(progress.LearningEvent(event_key=uuid4().hex, client_id=owner,
                                     event_type="word_reviewed", word_text="forgotten",
                                     occurred_at=datetime(2026, 1, 1, 12) + timedelta(days=i)))
    db.add(progress.LearningEvent(event_key=uuid4().hex, client_id=owner,
                                 event_type="word_reviewed", word_text="today",
                                 occurred_at=datetime(2026, 10, 31, 11)))
    db.commit()
    stats = practice.compute_stats(db, owner, "Asia/Shanghai")
    assert stats["streak_days"] == 1 and stats["today_count"] == 0
    assert {"streak_3", "streak_7"} <= set(stats["earned_badges"])
    assert {"streak_3", "streak_7"} <= set(practice.compute_stats(db, owner, "UTC")["earned_badges"])


def test_claim_collision_keeps_account_canonical_receipt_and_merges_badges(db, owner):
    account = "u:" + uuid4().hex
    canonical = sessions.create_session(db, account, payload("collision", 33))
    canonical_id = canonical.id
    sessions.create_session(db, owner, payload("collision", 98))
    for i in range(10):
        words.create_word(db, owner, f"vocab-{i}", "", "", "")
    # Same word identity on each side is counted only once after the claim.
    words.create_word(db, account, "vocab-0", "", "", "")
    users.claim_device_data(db, owner, account)
    users.claim_device_data(db, owner, account)
    result = sessions.create_session(db, account, payload("collision", 99))
    assert result.id == canonical_id and result.overall == 33
    stats = practice.compute_stats(db, account)
    assert stats["total_sessions"] == 1 and stats["xp"] == 90
    assert {"words_10", "conversation_90"} <= set(stats["earned_badges"])
    assert practice.compute_stats(db, owner)["earned_badges"] == []


@pytest.mark.parametrize("operation", ["review", "delete", "master"])
def test_guest_mutation_started_before_claim_cannot_modify_claimed_word(db, owner, operation):
    account = "u:" + uuid4().hex
    word = words.create_word(db, owner, "private", "", "", "")
    with SessionLocal() as other:
        users.claim_device_data(other, owner, account)
    with pytest.raises(ValueError, match="Word no longer belongs"):
        if operation == "review":
            words.review_word(db, word, remembered=True)
        elif operation == "delete":
            words.delete_word(db, word)
        else:
            words.set_mastered(db, word, True)
    with SessionLocal() as check:
        saved = words.get_word(check, account, word.id)
        assert saved.last_reviewed is None and saved.box == 0 and not saved.mastered


@pytest.mark.parametrize("operation,source", [
    ("session", PracticeSession), ("practice", PracticeRecord), ("word", WordEntry),
])
def test_journal_failure_rolls_back_source_activity(db, owner, monkeypatch, operation, source):
    from app.services import progress

    def fail(*args, **kwargs):
        raise RuntimeError("journal unavailable")
    monkeypatch.setattr(progress, "record_event", fail)
    with pytest.raises(RuntimeError, match="journal unavailable"):
        if operation == "session":
            sessions.create_session(db, owner, payload("rollback"))
        elif operation == "practice":
            practice.create_record(db, owner, PracticeCreate(kind="interview", score=5))
        else:
            words.create_word(db, owner, "rollback", "", "", "")
    with SessionLocal() as check:
        assert check.scalar(select(func.count()).select_from(source).where(source.client_id == owner)) == 0
        assert practice.compute_stats(check, owner)["earned_badges"] == []


def test_review_journal_failure_rolls_back_scheduling(db, owner, monkeypatch):
    from app.services import progress

    entry = words.create_word(db, owner, "review", "", "", "")
    def fail(*args, **kwargs):
        raise RuntimeError("journal unavailable")
    monkeypatch.setattr(progress, "record_event", fail)
    with pytest.raises(RuntimeError):
        words.review_word(db, entry, True)
    db.refresh(entry)
    assert entry.box == 0 and entry.last_reviewed is None


def test_claim_failure_rolls_back_events_badges_and_sources(db, owner, monkeypatch):
    from app.services import progress

    account = "u:" + uuid4().hex
    sessions.create_session(db, owner, payload("claim-rollback"))
    def fail(*args, **kwargs):
        raise RuntimeError("award unavailable")
    with monkeypatch.context() as patch:
        patch.setattr(progress, "stats_and_awards", fail)
        with pytest.raises(RuntimeError):
            users.claim_device_data(db, owner, account)
    assert practice.compute_stats(db, owner)["total_sessions"] == 1
    assert "first_conversation" in practice.compute_stats(db, owner)["earned_badges"]
    assert practice.compute_stats(db, account)["total_sessions"] == 0
    assert len(sessions.list_sessions(db, owner)) == 1


def test_concurrent_distinct_activity_has_no_lost_xp_or_threshold_awards(owner):
    def save(i):
        with SessionLocal() as db:
            sessions.create_session(db, owner, payload(str(i)))
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(save, range(13)))
    with SessionLocal() as db:
        stats = practice.compute_stats(db, owner)
        assert stats["total_sessions"] == 13 and stats["level"] == 3 and stats["xp"] == 20
        assert {"conversations_10", "level_3"} <= set(stats["earned_badges"])


def test_word_identity_is_trimmed_case_sensitive_and_concurrent_collection_idempotent(owner):
    def collect(_):
        with SessionLocal() as db:
            return words.create_word(db, owner, "  Word  ", "", "", "").id
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(collect, range(8)))
    assert len(set(ids)) == 1
    with SessionLocal() as db:
        words.create_word(db, owner, "word", "", "", "")
        stats = practice.compute_stats(db, owner)
        assert stats["words_count"] == 2 and stats["xp"] == 10


def test_bound_connection_backfill_rollback_and_null_legacy_times():
    from app.services import progress

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE sessions (id INTEGER PRIMARY KEY, client_id VARCHAR(64), "
                             "client_session_id VARCHAR(64), scenario_id VARCHAR(64), overall INTEGER, "
                             "summary TEXT, tip TEXT, created_at DATETIME)")
        conn.exec_driver_sql("INSERT INTO sessions (id, client_id, client_session_id, scenario_id, overall) "
                             "VALUES (7, 'legacy-null', 'unknown-time', 'old', 88)")
    Base.metadata.create_all(engine)
    with engine.connect() as conn:
        transaction = conn.begin()
        progress.backfill_progress(conn)
        transaction.rollback()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(progress.LearningEvent)) == 0
        assert db.get(progress.ProgressMigration, 1) is None
    progress.backfill_progress(engine)
    with Session(engine) as db:
        stats = practice.compute_stats(db, "legacy-null")
        assert stats["total_sessions"] == 1 and stats["today_count"] == 0 and stats["streak_days"] == 0
        sessions.prune_sessions(db, "legacy-null", keep=0)
        receipt = sessions.create_session(db, "legacy-null", payload("unknown-time"))
        assert receipt.id == 7 and receipt.created_at is None
    engine.dispose()


def test_source_id_reuse_does_not_resurrect_expired_session_content(db, owner):
    original = sessions.create_session(db, owner, payload("expired-key"))
    sessions.prune_sessions(db, owner, keep=0)
    # Force the same source ID, as SQLite can do after pruning its highest row.
    new = PracticeSession(id=original.id, client_id=owner, client_session_id="different-key",
                          scenario_id="new-content", overall=10, summary="Do not return")
    db.add(new)
    db.commit()
    receipt = sessions.create_session(db, owner, payload("expired-key", 5))
    assert receipt.overall == 95 and receipt.detail_available is False
    assert not hasattr(receipt, "summary")


def test_empty_guest_stats_does_not_create_persistent_owner_state(db, owner):
    from app.models.progress import ProgressOwner

    stats = practice.compute_stats(db, owner, "Asia/Shanghai")
    assert stats["total_sessions"] == 0 and stats["earned_badges"] == []
    assert stats["timezone"] == "Asia/Shanghai"
    assert db.get(ProgressOwner, owner) is None
