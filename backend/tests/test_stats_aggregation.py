"""Journal-scale statistics return aggregates and local days, never event objects."""

from contextlib import contextmanager
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.db import Base
from app.models.progress import EarnedBadge, LearningEvent
from app.models.word import WordEntry
from app.services import progress


@pytest.fixture
def engine():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@contextmanager
def journal_reads(engine):
    """Count returned journal rows without replacing the production result."""
    queries, loads = [], []
    def before(conn, cursor, statement, parameters, context, executemany):
        if (statement.startswith("SELECT") or statement.startswith("WITH")) and "learning_events" in statement:
            queries.append((statement, parameters))
    def load(target, context):
        loads.append(target.event_key)
    event.listen(engine, "before_cursor_execute", before)
    event.listen(LearningEvent, "load", load)
    try:
        yield queries, loads
    finally:
        event.remove(engine, "before_cursor_execute", before)
        event.remove(LearningEvent, "load", load)


@pytest.mark.parametrize("event_count", [300, 3000, 12000])
def test_journal_growth_returns_only_one_summary_and_distinct_days(engine, event_count):
    with Session(engine) as db:
        db.add_all(LearningEvent(event_key=str(i), client_id="owner", event_type="word_reviewed",
            word_text=f"word-{i % 20}", occurred_at=datetime(2026, 11, 1) - timedelta(days=i % 7))
            for i in range(event_count))
        db.commit()
    with journal_reads(engine) as (queries, loads), Session(engine) as db:
        progress.lock_owner(db, "owner")
        result = progress.stats_and_awards(db, "owner", "Asia/Shanghai")
        db.rollback()
    assert result["today_count"] == 0 and result["total_sessions"] == 0
    assert loads == []  # Regresses if ordinary stats materialize journal entities.
    assert len(queries) == 1  # No new remote round trips per count/date/award.
    with engine.connect() as conn:
        rows = list(conn.exec_driver_sql(*queries[0]))
    assert len(rows) == 8  # Seven distinct local dates plus one totals row.
    assert max(len(str(value)) for row in rows for value in row if value is not None) <= 10


@pytest.mark.parametrize("zone", ["UTC", "America/New_York", "Asia/Kathmandu", "Australia/Lord_Howe"])
def test_postgres_query_attaches_utc_before_local_day_conversion(zone):
    from sqlalchemy.dialects import postgresql

    query = progress._activity_query("isolated-owner", zone, "postgresql")
    sql = str(query.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    # timezone(zone, timestamp WITHOUT time zone) would interpret the stored
    # UTC clock as local time and reverse the offset. The inner call must
    # attach UTC; the outer call produces the requested local wall clock.
    assert f"CAST(timezone('{zone}', timezone('UTC', learning_events.occurred_at)) AS DATE)" in sql
    assert "WHERE learning_events.client_id = 'isolated-owner'" in sql
    assert "spoken_local_date" not in sql
    assert "count(DISTINCT CASE WHEN" in sql
    assert "UNION ALL" in sql and "GROUP BY owner_events.local_day" in sql
    assert "learning_events.event_key" not in sql and "learning_events.source_id" not in sql


def test_sqlite_date_udf_is_connection_local_and_accepts_offset_timestamps(engine):
    with Session(engine) as db:
        progress.stats_and_awards(db, "empty")
        # Raw SQLite values can contain UTC offsets as well as the ordinary
        # UTC-naive ORM format. The callback retains datetime's offset meaning.
        values = db.connection().exec_driver_sql("SELECT spoken_local_date(?, ?), spoken_local_date(NULL, ?)",
            ("2026-11-01 23:30:00-04:00", "Asia/Kathmandu", "UTC")).one()
        assert tuple(values) == ("2026-11-02", None)
        function = next(row for row in db.connection().exec_driver_sql("PRAGMA function_list")
                        if row[0] == "spoken_local_date")
        assert function[5] & 0x800  # SQLITE_DETERMINISTIC, safe for repeated date groups.


def test_repeated_timestamps_do_not_repeat_timezone_conversion_per_event(engine, monkeypatch):
    conversions = []
    real_local_date = progress._local_date
    def local_date(timestamp, zone):
        conversions.append((timestamp, zone.key))
        return real_local_date(timestamp, zone)
    with Session(engine) as db:
        db.add_all(LearningEvent(event_key=str(i), client_id="owner", event_type="word_reviewed",
            occurred_at=datetime(2023, 2, 1) + timedelta(days=i % 10)) for i in range(2000))
        db.commit()
        monkeypatch.setattr(progress, "_local_date", local_date)
        result = progress.stats_and_awards(db, "owner", "Asia/Kathmandu")
    assert result["streak_days"] == result["today_count"] == 0
    # SQLite may evaluate the same date expression for WHERE and GROUP BY.
    # Parsing/converting identical (timestamp, zone) inputs must remain bounded
    # by their ten unique values, plus the clock's current local date.
    assert len(conversions) <= 11


@pytest.mark.parametrize("zone,now,timestamps,today_count,streak", [
    ("Asia/Kathmandu", datetime(2026, 11, 1, 19),
     [datetime(2026, 11, 1, 18, 14, 59), datetime(2026, 11, 1, 18, 15)], 1, 2),
    ("Asia/Kolkata", datetime(2026, 11, 1, 19),
     [datetime(2026, 11, 1, 18, 29, 59), datetime(2026, 11, 1, 18, 30)], 1, 2),
    ("America/New_York", datetime(2026, 11, 1, 7),
     [datetime(2026, 11, 1, 3, 59), datetime(2026, 11, 1, 5, 30), datetime(2026, 11, 1, 6, 30)], 2, 2),
    ("America/New_York", datetime(2026, 3, 8, 8),
     [datetime(2026, 3, 8, 4, 59), datetime(2026, 3, 8, 6, 59), datetime(2026, 3, 8, 7)], 2, 2),
    ("Australia/Lord_Howe", datetime(2026, 10, 4, 3),
     [datetime(2026, 10, 3, 13, 29), datetime(2026, 10, 3, 15, 15), datetime(2026, 10, 3, 15, 45)], 2, 2),
    ("invalid/zone", datetime(2026, 11, 1, 0, 1),
     [datetime(2026, 10, 31, 23, 59), datetime(2026, 11, 1)], 1, 2),
])
def test_sql_and_supplied_events_match_at_timezone_boundaries(engine, monkeypatch,
        zone, now, timestamps, today_count, streak):
    monkeypatch.setattr(progress, "utcnow", lambda: now)
    events = [LearningEvent(event_key=uuid4().hex, client_id="owner", event_type="practice",
        kind="interview", score=5, occurred_at=timestamp) for timestamp in timestamps]
    # Null timestamps retain lifetime credit but cannot create an activity day.
    events.append(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type="session",
        score=None, scenario_id="", occurred_at=None))
    with Session(engine, expire_on_commit=False) as db:
        db.add_all(events)
        db.commit()
        supplied = progress.stats_and_awards(db, "owner", zone, events=events)
        db.rollback()
        aggregated = progress.stats_and_awards(db, "owner", zone)
        db.rollback()
    assert aggregated == supplied
    assert aggregated["today_count"] == today_count
    assert aggregated["streak_days"] == streak
    assert aggregated["total_sessions"] == 1 and aggregated["total_practice"] == len(timestamps)
    assert aggregated["timezone"] == (zone if zone != "invalid/zone" else "UTC")


def test_aggregates_preserve_unique_lifetime_credit_and_permanent_badges(engine, monkeypatch):
    monkeypatch.setattr(progress, "utcnow", lambda: datetime(2026, 11, 1))
    events = []
    for i in range(60):
        for event_type in ["word_collected", "word_reviewed"]:
            events.append(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type=event_type,
                word_text=f"Word-{i % 50}", occurred_at=datetime(2020, 1, 1) + timedelta(days=i % 7)))
    for event_type, word_text in [("word_collected", ""), ("word_collected", "word-0"),
                                   ("word_collected", None), ("word_reviewed", None)]:
        events.append(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type=event_type,
            word_text=word_text, occurred_at=None))
    events.extend(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type="session",
        score=95 if i == 0 else None, scenario_id=f"s{i % 5}", occurred_at=None) for i in range(10))
    events.extend(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type="practice",
        kind="interview", score=5, occurred_at=None) for _ in range(3))
    events.append(LearningEvent(event_key=uuid4().hex, client_id="owner", event_type="practice",
        kind="pronunciation", score=90, occurred_at=None))
    with Session(engine, expire_on_commit=False) as db:
        db.add_all(events)
        db.add(LearningEvent(event_key="other", client_id="other", event_type="session", score=100))
        db.add(WordEntry(client_id="owner", text="only retained word"))
        db.add(EarnedBadge(client_id="owner", badge_key="legacy_permanent", earned_at=datetime(2019, 1, 1)))
        db.commit()
        supplied = progress.stats_and_awards(db, "owner", events=events)
        db.rollback()
        aggregate = progress.stats_and_awards(db, "owner")
        db.rollback()
    assert aggregate == supplied
    assert aggregate["xp"] == 220 and aggregate["level"] == 3  # 400 + 60 + 52*5 = 720
    assert aggregate["words_count"] == 1 and aggregate["today_count"] == aggregate["streak_days"] == 0
    assert set(aggregate["earned_badges"]) == {"legacy_permanent", "first_conversation", "conversations_10",
        "words_10", "words_50", "reviewed_words_10", "streak_3", "streak_7", "pronunciation_90",
        "interviews_3", "conversation_90", "scenarios_5", "level_3"}


def test_supplied_events_remain_authoritative_and_do_not_read_journal(engine):
    with Session(engine) as db:
        db.add(LearningEvent(event_key="stored", client_id="owner", event_type="session"))
        db.commit()
        with journal_reads(engine) as (queries, loads):
            result = progress.stats_and_awards(db, "owner", events=[])
        assert queries == loads == []
        assert result["total_sessions"] == result["total_practice"] == result["xp"] == 0
