"""Regression coverage for an idle connection closed outside SQLAlchemy."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect

import app.db as database
from app.main import app


def test_ready_probe_round_trips_to_the_database():
    response = TestClient(app).get("/api/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": "Spoken", "database": "ok"}
    assert response.headers["cache-control"] == "no-store"


def test_closed_idle_connection_is_replaced_before_business_query():
    database.engine.dispose()
    with database.engine.connect() as connection:
        connection.exec_driver_sql("SELECT 1")
        raw = connection.connection.dbapi_connection
    # Simulates the server terminating an idle connection in the pool.
    raw.close()
    with database.engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT 42").scalar_one() == 42
        assert connection.connection.dbapi_connection is not raw


def test_legacy_telemetry_migration_preserves_rows_and_is_repeatable(tmp_path, monkeypatch):
    legacy = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    try:
        with legacy.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE telemetry_records (id INTEGER PRIMARY KEY, trace_id TEXT)")
            connection.exec_driver_sql("INSERT INTO telemetry_records VALUES (1, 'legacy-trace')")
        monkeypatch.setattr(database, "engine", legacy)
        monkeypatch.setattr(database, "_url", str(legacy.url))
        database._migrate_telemetry_errors()
        database._migrate_telemetry_errors()
        columns = {column['name'] for column in inspect(legacy).get_columns('telemetry_records')}
        assert {'error_type', 'error_cause_type', 'received_at', 'is_replay'} <= columns
        with legacy.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT trace_id, error_type, error_cause_type, received_at, is_replay FROM telemetry_records"
            ).one() == ('legacy-trace', None, None, None, None)
    finally:
        legacy.dispose()


def test_legacy_word_bag_migration_preserves_scheduling_and_scenario(monkeypatch):
    legacy = create_engine("sqlite://")
    try:
        with legacy.begin() as connection:
            connection.exec_driver_sql("""CREATE TABLE words (
                id INTEGER PRIMARY KEY, text TEXT, scenario_id TEXT, created_at DATETIME,
                due_at DATETIME, box INTEGER, topic VARCHAR(48), familiarity VARCHAR(16)
            )""")
            connection.exec_driver_sql("""INSERT INTO words VALUES
                (1, 'sign the contract', 'negotiation', '2026-11-20', '2026-11-28', 3, '签约', 'familiar')""")
        monkeypatch.setattr(database, "engine", legacy)
        monkeypatch.setattr(database, "_url", str(legacy.url))
        database._migrate_sqlite()
        database._migrate_sqlite()
        with legacy.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT scenario_id, due_at, box, topic, familiarity, source, review_translation FROM words"
            ).one() == ("negotiation", "2026-11-28", 3, "签约", "familiar", None, None)
    finally:
        legacy.dispose()


@pytest.mark.skipif(database.engine.dialect.name != "postgresql", reason="requires PostgreSQL word-bag DDL")
def test_postgres_word_source_migration_preserves_legacy_rows_on_concurrent_startup(monkeypatch):
    test_engine = database.engine
    schema = f"word_source_migration_{uuid4().hex}"
    with test_engine.begin() as connection:
        connection.exec_driver_sql(f"CREATE SCHEMA {schema}")
    legacy = create_engine(test_engine.url, connect_args={"options": f"-c search_path={schema}"})
    try:
        with legacy.begin() as connection:
            connection.exec_driver_sql("""CREATE TABLE words (
                id INTEGER PRIMARY KEY, text VARCHAR(128), scenario_id VARCHAR(64),
                due_at TIMESTAMP, box INTEGER, topic VARCHAR(48), familiarity VARCHAR(16)
            )""")
            connection.exec_driver_sql("CREATE TABLE learning_events (word_text VARCHAR(128))")
            connection.exec_driver_sql("""INSERT INTO words VALUES (1, 'sign the contract',
                'negotiation', '2026-11-28 09:00:00', 3, '签约', 'familiar')""")
        with monkeypatch.context() as migration:
            migration.setattr(database, "engine", legacy)
            with ThreadPoolExecutor(max_workers=2) as workers:
                runs = [workers.submit(database._migrate_word_topics) for _ in range(2)]
                for run in runs:
                    run.result(timeout=20)
        inspector = inspect(legacy)
        words = {column["name"]: column["type"] for column in inspector.get_columns("words")}
        events = {column["name"]: column["type"] for column in inspector.get_columns("learning_events")}
        assert words["text"].length == events["word_text"].length == 600
        with legacy.begin() as connection:
            assert connection.exec_driver_sql("""SELECT scenario_id, due_at::text, box, topic, familiarity, source,
                review_translation FROM words WHERE id = 1""").one() == (
                    "negotiation", "2026-11-28 09:00:00", 3, "签约", "familiar", None, None,
                )
            connection.exec_driver_sql("""UPDATE words SET source = '{"key":"negotiation"}' WHERE id = 1""")
            assert connection.exec_driver_sql("SELECT source FROM words WHERE id = 1").scalar_one() == {"key": "negotiation"}
    finally:
        legacy.dispose()
        with test_engine.begin() as connection:
            connection.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
