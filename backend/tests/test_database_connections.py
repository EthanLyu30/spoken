"""Regression coverage for an idle connection closed outside SQLAlchemy."""
from sqlalchemy import create_engine, inspect

import app.db as database


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
        database._migrate_telemetry_errors()
        database._migrate_telemetry_errors()
        columns = {column['name'] for column in inspect(legacy).get_columns('telemetry_records')}
        assert {'error_type', 'error_cause_type'} <= columns
        with legacy.connect() as connection:
            assert connection.exec_driver_sql(
                "SELECT trace_id, error_type, error_cause_type FROM telemetry_records"
            ).one() == ('legacy-trace', None, None)
    finally:
        legacy.dispose()
