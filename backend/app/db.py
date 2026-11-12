"""Database engine, session factory and FastAPI dependency.

SQLite by default (zero-config, easy for reviewers to reproduce). The URL can be
overridden with the ``DATABASE_URL`` env var (used by the test suite).
"""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings
from app.core.performance import MeasuredSession, install_sql_timings


class Base(DeclarativeBase):
    pass


_url = get_settings().database_url
_connect_args = {"check_same_thread": False} if _url.startswith("sqlite") else {}
# Managed databases may terminate idle connections while the app stays alive.
# Check on checkout; never replay an application transaction after failure.
# Remote Postgres benefits from a slightly larger LIFO pool: the most recently
# used connection is already warm, and a bounded wait prevents an exhausted
# pool from hanging a request for SQLAlchemy's 30 s default.
_pool_options = {} if _url.startswith("sqlite") else {
    "pool_size": 10,
    "max_overflow": 20,
    "pool_recycle": 300,
    "pool_use_lifo": True,
    "pool_timeout": 10,
}
engine = create_engine(
    _url, connect_args=_connect_args, future=True, pool_pre_ping=True, **_pool_options
)
install_sql_timings()
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, expire_on_commit=False, class_=MeasuredSession
)


def _migrate_sqlite() -> None:
    """Add columns introduced after a table first shipped (SQLite only).

    ``create_all`` never alters an existing table, so a dev database created
    before the spaced-repetition fields would be missing them. Add any missing
    columns in place so existing word bags keep working.
    """
    if not _url.startswith("sqlite"):
        return

    _CID = "ADD COLUMN client_id VARCHAR(64) NOT NULL DEFAULT 'anon'"
    additions = {
        "words": {
            "box": "ALTER TABLE words ADD COLUMN box INTEGER NOT NULL DEFAULT 0",
            "due_at": "ALTER TABLE words ADD COLUMN due_at DATETIME",
            "last_reviewed": "ALTER TABLE words ADD COLUMN last_reviewed DATETIME",
            "client_id": f"ALTER TABLE words {_CID}",
        },
        "sessions": {"client_id": f"ALTER TABLE sessions {_CID}"},
        "practice_records": {"client_id": f"ALTER TABLE practice_records {_CID}"},
    }
    with engine.begin() as conn:
        for table, cols in additions.items():
            existing = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not existing:
                continue  # table not created yet; create_all will handle it
            for col, ddl in cols.items():
                if col not in existing:
                    conn.exec_driver_sql(ddl)
            if "due_at" in cols and "due_at" not in existing:
                conn.exec_driver_sql("UPDATE words SET due_at = created_at WHERE due_at IS NULL")


def _migrate_users() -> None:
    """Add the editable-profile columns to an existing ``users`` table.

    ``create_all`` won't alter a table that already exists (shipped earlier with
    the account feature), so add ``display_name`` / ``avatar_url`` in place. Works
    on both SQLite (PRAGMA check) and Postgres (ADD COLUMN IF NOT EXISTS).
    """
    cols = {
        "display_name": "VARCHAR(40) NOT NULL DEFAULT ''",
        "avatar_url": "TEXT NOT NULL DEFAULT ''",
        "auth_version": "VARCHAR(32) NOT NULL DEFAULT ''",
        "email_verified_at": "TIMESTAMP",
    }
    with engine.begin() as conn:
        if _url.startswith("sqlite"):
            existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)")}
            if not existing:
                return  # table not created yet; create_all handles fresh DBs
            for col, ddl in cols.items():
                if col not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
        else:
            for col, ddl in cols.items():
                conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col} {ddl}")


def init_db() -> None:
    """Create tables (idempotent). Importing models registers their mappers."""
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_sqlite()
    _migrate_users()
    _migrate_session_identity()
    _migrate_telemetry_errors()
    from app.services.progress import backfill_progress

    backfill_progress(engine)


def _migrate_telemetry_errors() -> None:
    """Add content-free diagnostics without changing historical records."""
    columns = {"error_type": 100, "error_cause_type": 100, "test_run_id": 64, "guest_subject_hash": 64}
    with engine.begin() as conn:
        if _url.startswith("sqlite"):
            existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(telemetry_records)")}
            if not existing:
                return
            for column, size in columns.items():
                if column not in existing:
                    conn.exec_driver_sql(f"ALTER TABLE telemetry_records ADD COLUMN {column} VARCHAR({size})")
        else:
            for column, size in columns.items():
                conn.exec_driver_sql(f"ALTER TABLE telemetry_records ADD COLUMN IF NOT EXISTS {column} VARCHAR({size})")


def _migrate_session_identity() -> None:
    """Keep legacy rows unchanged; idempotency applies to new client IDs only."""
    with engine.begin() as conn:
        if _url.startswith("sqlite"):
            existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(sessions)")}
            if "client_session_id" not in existing:
                conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN client_session_id VARCHAR(64)")
        else:
            conn.exec_driver_sql("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_session_id VARCHAR(64)")
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_owner_practice ON sessions (client_id, client_session_id)")


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
