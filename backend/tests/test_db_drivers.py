"""Check production DB driver imports without connecting to a real database."""

import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    ("database_url", "supported_drivers"),
    [
        ("postgresql+psycopg://test:test@localhost/spoken", {"psycopg"}),
        ("postgresql+psycopg2://test:test@localhost/spoken", {"psycopg2"}),
        ("postgresql://test:test@localhost/spoken", {"psycopg", "psycopg2"}),
    ],
)
def test_database_engine_imports_postgres_driver(database_url, supported_drivers):
    # The main suite uses SQLite. A fresh process exercises app.db with each
    # supported production URL and actually imports its runtime driver. Engine
    # construction does not connect, run migrations, or read production data.
    environment = {
        **os.environ,
        "DATABASE_URL": database_url,
        "DEEPSEEK_MODEL": "deepseek-flash",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.db import engine; "
            "print(engine.dialect.name); print(engine.dialect.driver); "
            "engine.dispose()",
        ],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr
    dialect, driver = result.stdout.strip().splitlines()
    assert dialect == "postgresql"
    assert driver in supported_drivers
