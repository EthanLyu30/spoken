"""Real SQL budgets and projection/compatibility checks on synthetic data."""

from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from app.api.sessions import router
from app.db import Base, get_db
from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, LearningEvent, ProgressOwner
from app.models.session import PracticeSession, SkillScore, Turn
from app.models.word import WordEntry
from app.schemas.practice import PracticeRecordOut
from app.services import practice, progress, sessions


@pytest.fixture
def engine(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "progress_reads.db"),
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@contextmanager
def trace(engine):
    calls, checkouts = [], []
    def sql(conn, cursor, statement, parameters, context, executemany):
        calls.append((statement, parameters))
    def checkout(*args):
        checkouts.append(1)
    event.listen(engine, "before_cursor_execute", sql)
    event.listen(engine, "checkout", checkout)
    try:
        yield calls, checkouts
    finally:
        event.remove(engine, "before_cursor_execute", sql)
        event.remove(engine, "checkout", checkout)


def selected_bytes(engine, calls):
    """UTF-8 value bytes, excluding protocol overhead; synthetic SELECT replay."""
    with engine.connect() as conn:
        return sum(len(str(value).encode("utf-8")) for sql, params in calls
                   if sql.startswith("SELECT")
                   for row in conn.exec_driver_sql(sql, params) for value in row
                   if value is not None)


def test_empty_stats_one_snapshot_no_owner_write_and_permanent_badges(engine):
    with Session(engine) as db:
        db.add(EarnedBadge(client_id="empty", badge_key="words_50", earned_at=datetime(2020, 1, 1)))
        db.add(WordEntry(client_id="empty", text="retained"))
        db.add(WordEntry(client_id="other", text="other"))
        db.commit()
    with trace(engine) as (calls, checkouts), Session(engine) as db:
        result = practice.compute_stats(db, "empty", "Asia/Shanghai")
    assert result["total_sessions"] == result["total_practice"] == 0
    assert result["words_count"] == 1 and result["earned_badges"] == ["words_50"]
    assert len(calls) == 1 and len(checkouts) == 1
    assert "EXISTS" in calls[0][0] and "LEFT OUTER JOIN earned_badges" in calls[0][0]
    with Session(engine) as db:
        assert db.get(ProgressOwner, "empty") is None
    print(f"empty stats: SQL={len(calls)}, checkouts={len(checkouts)}, selected_bytes={selected_bytes(engine, calls)}")


@pytest.mark.parametrize("count", [1, 1300])
def test_populated_stats_four_statements_and_one_bounded_award_insert(engine, count):
    with Session(engine) as db:
        db.add_all(LearningEvent(event_key=str(i), client_id="populated", event_type="session")
                   for i in range(count))
        db.commit()
        with trace(engine) as (first, _):
            initial = practice.compute_stats(db, "populated")
        assert len(first) == 5  # probe, lock, events, metadata, one batch award
    with trace(engine) as (calls, checkouts), Session(engine) as db:
        repeated = practice.compute_stats(db, "populated")
    assert repeated == initial and repeated["total_sessions"] == count
    assert len(calls) == 4 and len(checkouts) == 1
    assert "ON CONFLICT" in calls[1][0] and "DO UPDATE" in calls[1][0]
    assert not any(sql.startswith("UPDATE ") for sql, _ in calls)
    assert "LEFT OUTER JOIN earned_badges" in calls[3][0]
    print(f"populated {count}: SQL={len(calls)}, checkouts={len(checkouts)}, selected_bytes={selected_bytes(engine, calls)}")


def test_populated_stats_rereads_badges_and_words_after_owner_lock(engine, monkeypatch):
    with Session(engine) as db:
        db.add(LearningEvent(event_key="prior", client_id="owner", event_type="session"))
        db.commit()
    real_lock = progress.lock_owner
    def writer_before_lock(db, client_id):
        # Model a writer finishing between the speculative probe and this lock.
        with Session(engine) as writer:
            writer.add(EarnedBadge(client_id=client_id, badge_key="words_50", earned_at=datetime(2020, 1, 1)))
            writer.add(WordEntry(client_id=client_id, text="fresh"))
            writer.commit()
        real_lock(db, client_id)
    monkeypatch.setattr(progress, "lock_owner", writer_before_lock)
    with Session(engine) as db:
        result = practice.compute_stats(db, "owner")
    assert result["words_count"] == 1
    assert result["earned_badges"] == ["first_conversation", "words_50"]


def test_empty_stats_keeps_its_snapshot_when_an_activity_writer_races(engine, monkeypatch):
    real_snapshot = progress.read_snapshot
    def snapshot_then_writer(db, client_id, **kwargs):
        snapshot = real_snapshot(db, client_id, **kwargs)
        if kwargs.get("include_events"):
            with Session(engine) as writer:
                progress.lock_owner(writer, client_id)
                progress.record_event(writer, client_id, "session", score=95)
                writer.add(WordEntry(client_id=client_id, text="racing word"))
                progress.stats_and_awards(writer, client_id)
                writer.commit()
        return snapshot
    monkeypatch.setattr(progress, "read_snapshot", snapshot_then_writer)
    with Session(engine) as db:
        result = practice.compute_stats(db, "racing")
    assert result["total_sessions"] == result["words_count"] == 0
    assert result["earned_badges"] == []
    monkeypatch.setattr(progress, "read_snapshot", real_snapshot)
    with Session(engine) as db:
        next_read = practice.compute_stats(db, "racing")
    assert next_read["total_sessions"] == next_read["words_count"] == 1
    assert next_read["earned_badges"] == ["conversation_90", "first_conversation"]


def seed_sessions(engine, count):
    with Session(engine) as db:
        for i in range(count):
            db.add(PracticeSession(client_id="owner", scenario_id="cafe", overall=70,
                created_at=datetime(2026, 1, 1) + timedelta(days=i),
                summary="s" * 4000, tip="t" * 2000,
                turns=[Turn(idx=0, role="user", content="private" * 5000)],
                scores=[SkillScore(key="grammar", label_en="Grammar", label_zh="语法", score=40 + i % 12),
                        SkillScore(key="vocabulary", label_en="Vocabulary", label_zh="词汇", score=90)]))
        db.add(PracticeSession(client_id="other", scenario_id="secret", overall=1,
            created_at=datetime(2030, 1, 1), summary="other private text",
            scores=[SkillScore(key="secret", label_en="Secret", label_zh="秘密", score=1)]))
        db.commit()


def overview_client(engine):
    app = FastAPI()
    app.include_router(router, prefix="/api")
    def db_override():
        with Session(engine) as db:
            yield db
    app.dependency_overrides[get_db] = db_override
    return TestClient(app, headers={"X-Client-Id": "owner"})


@pytest.mark.parametrize("count", [0, 12, 200])
def test_overview_two_thin_queries_preserves_insights_and_latest_radar(engine, count):
    seed_sessions(engine, count)
    with trace(engine) as (old_calls, old_checkouts):
        with Session(engine) as db:
            old_summaries = sessions.list_sessions(db, "owner")
        with Session(engine) as db:
            old_insights = practice.compute_insights(db, "owner")
        if old_summaries:
            with Session(engine) as db:
                detail = sessions.get_session(db, "owner", old_summaries[0].id)
                list(detail.scores)
                list(detail.turns)
    with trace(engine) as (calls, checkouts):
        response = overview_client(engine).get("/api/progress/sessions")
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"sessions", "insights", "latest"}
    assert body["insights"] == old_insights
    assert len(body["sessions"]) == min(count, 50)
    assert all(set(row) == {"id", "scenario_id", "overall", "created_at"} for row in body["sessions"])
    assert len(calls) == (2 if count else 1) and len(checkouts) == 1
    for sql, _ in calls:
        assert not any(column in sql for column in ("sessions.summary", "sessions.tip", "turns", "client_session_id"))
    if count:
        assert set(body["latest"]) == {"id", "scores"}
        assert body["latest"]["id"] == body["sessions"][0]["id"]
        assert [s["key"] for s in body["latest"]["scores"]] == ["grammar", "vocabulary"]
        assert body["latest"]["scores"][0]["score"] == 40 + (count - 1) % 12
        assert "JOIN sessions" in calls[1][0] and "sessions.client_id" in calls[1][0]
        assert body["insights"]["sessions"] == 8
        if count == 12:
            assert body["insights"]["weakest"] == {"key": "grammar", "label_en": "Grammar",
                "label_zh": "语法", "avg": 48, "delta": 4, "samples": 8}
    else:
        assert body["latest"] is None and body["insights"]["available"] is False
    print(f"overview {count}: SQL={len(calls)}, checkouts={len(checkouts)}, selected_bytes={selected_bytes(engine, calls)}")
    print(f"previous session APIs {count}: SQL={len(old_calls)}, checkouts={len(old_checkouts)}, selected_bytes={selected_bytes(engine, old_calls)}")


def test_overview_counts_unscored_sessions_without_falling_back_to_older_radar(engine):
    with Session(engine) as db:
        db.add(PracticeSession(client_id="owner", scenario_id="cafe", overall=70,
            created_at=datetime(2026, 1, 1),
            scores=[SkillScore(key="grammar", label_en="Grammar", label_zh="语法", score=71)]))
        db.add(PracticeSession(client_id="owner", scenario_id="cafe", overall=70,
            created_at=datetime(2026, 1, 2)))
        db.commit()
    body = overview_client(engine).get("/api/progress/sessions").json()
    assert body["insights"]["sessions"] == 2
    assert body["insights"]["weakest"]["samples"] == 1
    assert body["insights"]["weakest"]["avg"] == 71
    assert body["insights"]["weakest"]["delta"] == 0
    assert body["latest"] == {"id": body["sessions"][0]["id"], "scores": []}


def test_overview_rechecks_score_owner_after_metadata_read(engine):
    seed_sessions(engine, 12)
    def move_latest(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("SELECT scores.session_id"):
            conn.exec_driver_sql("UPDATE sessions SET client_id = 'other' WHERE id = 12")
    event.listen(engine, "before_cursor_execute", move_latest)
    try:
        body = overview_client(engine).get("/api/progress/sessions").json()
    finally:
        event.remove(engine, "before_cursor_execute", move_latest)
    assert body["latest"] == {"id": 12, "scores": []}
    assert body["insights"]["sessions"] == 8
    assert body["insights"]["weakest"]["samples"] == 7


@pytest.mark.parametrize("headers, status", [({"X-Client-Id": ""}, 400),
    ({"X-Client-Id": "u:1"}, 400), ({"Authorization": "Bearer invalid"}, 401)])
def test_overview_rejects_ambiguous_or_invalid_owners_without_sql(engine, headers, status):
    with trace(engine) as (calls, checkouts):
        response = overview_client(engine).get("/api/progress/sessions", headers=headers)
    assert response.status_code == status
    assert calls == checkouts == []


def test_practice_history_projects_pronunciation_detail_out_preserves_all_scales(engine):
    details = [("pronunciation", "p" * 48000, 100),
               ("interview", '{"score_max":5,"scoring_version":"ets-interview-text-v1"}', 5),
               ("interview", '{"score_max":5,"scoring_version":"unknown"}', 6),
               ("interview", '{"score_max":5}', 6), ("interview", "malformed", 6),
               ("interview", "", 6), ("interview", "[]", 6)]
    with Session(engine) as db:
        db.add_all(PracticeRecord(client_id="owner", kind=kind, detail=detail, title=str(i), score=4)
                   for i, (kind, detail, _) in enumerate(details))
        db.add(PracticeRecord(client_id="other", kind="interview", detail="secret", title="other"))
        db.commit()
    with trace(engine) as (calls, checkouts), Session(engine) as db:
        rows = practice.list_records(db, "owner")
        outputs = [PracticeRecordOut.model_validate(r).model_dump() for r in rows]
    assert {int(row["title"]): row["score_max"] for row in outputs} == dict(enumerate(x[2] for x in details))
    assert len(calls) == len(checkouts) == 1
    with engine.connect() as conn:
        raw_rows = conn.exec_driver_sql(*calls[0]).fetchall()
    assert not any(value == "p" * 48000 for row in raw_rows for value in row)
    assert "CASE WHEN" in calls[0][0]
    with Session(engine) as db:
        pronunciation = db.scalar(select(PracticeRecord).where(PracticeRecord.kind == "pronunciation"))
        assert pronunciation.detail == "p" * 48000
        assert len(practice.list_records(db, "owner", "interview", 2)) == 2
    print(f"practice history: SQL={len(calls)}, checkouts={len(checkouts)}, selected_bytes={selected_bytes(engine, calls)}")
