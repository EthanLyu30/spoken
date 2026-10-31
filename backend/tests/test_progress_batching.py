"""Bound actual database executions, not Python calls or executemany wrappers."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, delete, event, func, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, LearningEvent, ProgressMigration
from app.models.session import PracticeSession
from app.models.word import WordEntry
from app.schemas.session import SaveSessionRequest
from app.schemas.practice import PracticeCreate
from app.services import practice, progress, sessions

ALL_BADGES = sorted(["first_conversation", "streak_3", "streak_7", "conversations_10",
                     "words_10", "words_50", "reviewed_words_10", "pronunciation_90",
                     "interviews_3", "conversation_90", "scenarios_5", "level_3"])


@contextmanager
def trace_sql(engine):
    calls = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        calls.append((statement, parameters, executemany))
    event.listen(engine, "before_cursor_execute", capture)
    try:
        yield calls
    finally:
        event.remove(engine, "before_cursor_execute", capture)


@pytest.fixture
def engine():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def seed_legacy(engine):
    with Session(engine) as db:
        db.add_all([PracticeSession(id=i + 1, client_id="legacy", client_session_id=f"receipt-{i}",
                    scenario_id=f"scene-{i % 5}", overall=95,
                    created_at=datetime(2020, 1, 1) + timedelta(days=i % 7), summary="private")
                    for i in range(200)])
        db.add_all([PracticeRecord(id=i + 1, client_id="legacy", kind="interview" if i < 3 else "pronunciation",
                    score=5 if i < 3 else 91, created_at=datetime(2020, 1, 1), detail="private")
                    for i in range(1000)])
        db.add_all([WordEntry(id=i + 1, client_id="legacy", text=f" word-{i} ", box=1,
                    created_at=datetime(2020, 1, 1), last_reviewed=None if i % 2 else datetime(2020, 1, 2))
                    for i in range(50)])
        db.commit()


def assert_legacy_outcome(engine):
    with Session(engine) as db:
        stats = practice.compute_stats(db, "legacy")
        assert stats["total_sessions"] == 200 and stats["total_practice"] == 1000
        assert stats["level"] == 94 and stats["xp"] == 0  # 8000 + 15000 + 250
        assert stats["earned_badges"] == ALL_BADGES
        assert stats["today_count"] == 0 and stats["streak_days"] == 0
        assert db.scalar(select(func.count()).select_from(LearningEvent)) == 1300
        assert db.scalar(select(func.count()).select_from(LearningEvent).where(
            LearningEvent.event_type == "word_reviewed", LearningEvent.occurred_at.is_(None))) == 25
        receipt = db.get(LearningEvent, "legacy:session:1")
        assert (receipt.source_id, receipt.client_session_id, receipt.scenario_id, receipt.score) == (1, "receipt-0", "scene-0", 95)
        assert db.get(LearningEvent, "legacy:word:1").word_text == "word-0"
        assert db.get(LearningEvent, "legacy:review:1").occurred_at == datetime(2020, 1, 2)
        assert db.get(ProgressMigration, 1) is not None


def test_retention_scale_backfill_uses_bounded_real_multirow_sql(engine):
    seed_legacy(engine)
    with trace_sql(engine) as calls:
        progress.backfill_progress(engine)
    inserts = [call for call in calls if call[0].startswith("INSERT INTO learning_events")]
    print(f"migration SQL: total={len(calls)}, event INSERTs={len(inserts)}")
    assert_legacy_outcome(engine)
    assert len(calls) <= 35
    assert 2 <= len(inserts) <= 20
    assert all(not many and "), (" in sql and len(params) <= 900 for sql, params, many in inserts)
    source_selects = [sql for sql, _, _ in calls if sql.startswith("SELECT") and
                      any(f"FROM {table}" in sql for table in ("sessions", "practice_records", "words"))]
    assert not any(column in sql for sql in source_selects for column in (".summary", ".detail", ".meaning", ".example"))
    with trace_sql(engine) as repeated:
        progress.backfill_progress(engine)
    assert len(repeated) == 3
    assert not any(sql.startswith("INSERT INTO learning_events") for sql, _, _ in repeated)
    assert_legacy_outcome(engine)


def test_fully_awarded_stats_do_not_insert_badges_again_and_keep_permanent_union(engine):
    seed_legacy(engine)
    progress.backfill_progress(engine)
    with trace_sql(engine) as calls, Session(engine) as db:
        stats = practice.compute_stats(db, "legacy")
    inserts = [sql for sql, _, _ in calls if sql.startswith("INSERT INTO earned_badges")]
    print(f"repeat stats SQL: total={len(calls)}, badge INSERTs={len(inserts)}")
    assert stats["earned_badges"] == ALL_BADGES
    assert inserts == []
    assert len([sql for sql, _, _ in calls if sql.startswith("SELECT earned_badges")]) == 1
    with Session(engine) as db:
        db.execute(delete(LearningEvent))
        db.commit()
        assert practice.compute_stats(db, "legacy")["earned_badges"] == ALL_BADGES


def test_new_threshold_awards_use_one_insert_and_preserve_previous_keys(engine):
    with Session(engine) as db:
        db.add(EarnedBadge(client_id="threshold", badge_key="words_50", earned_at=datetime(2020, 1, 1)))
        db.add_all([LearningEvent(event_key=str(i), client_id="threshold", event_type="session",
                    scenario_id=f"scene-{i % 5}", score=95) for i in range(10)])
        db.commit()
        with trace_sql(engine) as calls:
            stats = practice.compute_stats(db, "threshold")
        assert stats["earned_badges"] == ["conversation_90", "conversations_10", "first_conversation", "scenarios_5", "words_50"]
        inserts = [call for call in calls if call[0].startswith("INSERT INTO earned_badges")]
        assert len(inserts) == 1 and not inserts[0][2] and "), (" in inserts[0][0]
        assert db.get(EarnedBadge, ("threshold", "words_50")).earned_at == datetime(2020, 1, 1)


def test_failure_in_later_backfill_batch_rolls_back_all_events_awards_and_marker(engine):
    seed_legacy(engine)
    event_sql = []
    def fail_later(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO learning_events"):
            event_sql.append(statement)
            if len(event_sql) == 3:
                raise RuntimeError("third batch interrupted")
    event.listen(engine, "before_cursor_execute", fail_later)
    try:
        with pytest.raises(RuntimeError, match="third batch interrupted"):
            progress.backfill_progress(engine)
    finally:
        event.remove(engine, "before_cursor_execute", fail_later)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(LearningEvent)) == 0
        assert db.scalar(select(func.count()).select_from(EarnedBadge)) == 0
        assert db.get(ProgressMigration, 1) is None
        assert db.scalar(select(func.count()).select_from(PracticeRecord)) == 1000
    progress.backfill_progress(engine)
    assert_legacy_outcome(engine)


def test_backfill_batches_preserve_existing_legacy_receipts_and_awards(engine):
    seed_legacy(engine)
    with Session(engine) as db:
        db.add(LearningEvent(event_key="legacy:session:1", client_id="legacy", event_type="session",
            source_id=1, client_session_id="receipt-0", score=12, occurred_at=None))
        db.add(EarnedBadge(client_id="legacy", badge_key="first_conversation", earned_at=datetime(2019, 1, 1)))
        db.commit()
    progress.backfill_progress(engine)
    with Session(engine) as db:
        receipt = db.get(LearningEvent, "legacy:session:1")
        assert receipt.score == 12 and receipt.occurred_at is None
        assert db.scalar(select(func.count()).select_from(LearningEvent)) == 1300
        assert db.get(EarnedBadge, ("legacy", "first_conversation")).earned_at == datetime(2019, 1, 1)
        assert practice.compute_stats(db, "legacy")["earned_badges"] == ALL_BADGES


def test_award_batch_failure_rolls_back_source_and_event(engine):
    def fail_award(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO earned_badges"):
            raise RuntimeError("award batch unavailable")
    event.listen(engine, "before_cursor_execute", fail_award)
    try:
        with Session(engine) as db, pytest.raises(RuntimeError, match="award batch unavailable"):
            practice.create_record(db, "rollback", PracticeCreate(kind="pronunciation", score=91))
    finally:
        event.remove(engine, "before_cursor_execute", fail_award)
    with Session(engine) as db:
        for model in (PracticeRecord, LearningEvent, EarnedBadge):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_concurrent_threshold_writers_keep_one_permanent_award(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "awards.db"))
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([LearningEvent(event_key=str(i), client_id="threshold", event_type="session") for i in range(9)])
        db.commit()
    def save(i):
        with Session(engine) as db:
            sessions.create_session(db, "threshold", SaveSessionRequest(scenario_id="cafe",
                client_session_id=str(i), messages=[{"role": "user", "content": "Synthetic answer"}], overall=95))
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(save, range(4)))
        with Session(engine) as db:
            assert practice.compute_stats(db, "threshold")["total_sessions"] == 13
            assert db.scalar(select(func.count()).select_from(EarnedBadge).where(
                EarnedBadge.client_id == "threshold", EarnedBadge.badge_key == "conversations_10")) == 1
    finally:
        engine.dispose()
