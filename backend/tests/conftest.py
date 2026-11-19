"""Point the app at a throwaway SQLite database for the whole test run.

Must run before any `app.*` import so the engine in `app.db` is built against
the temp database rather than the real `spoken.db`.
"""

import atexit
import json
import os
import tempfile

import pytest

_fd, _path = tempfile.mkstemp(prefix="spoken_test_", suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = os.environ.get("SPOKEN_TEST_POSTGRES_URL") or "sqlite:///" + _path.replace(os.sep, "/")

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


@atexit.register
def _cleanup_test_db() -> None:
    """Remove the throwaway DB so temp files don't pile up across runs."""
    try:
        from app.db import engine

        engine.dispose()
    except Exception:
        pass
    try:
        os.remove(_path)
    except OSError:
        pass


@pytest.fixture(autouse=True)
def independent_request_quota(monkeypatch):
    # TestClient uses the same IP in every case. Keep the middleware's real
    # quota within each test, including when the suite runs on PostgreSQL.
    from app.core.ratelimit import SlidingWindowLimiter

    monkeypatch.setattr("app.main.limiter", SlidingWindowLimiter())


@pytest.fixture
def coaching_review_json():
    def review(*, problem="ready", exercise=None, turn_checks=None):
        approved = {"answers_question": True, "fulfills_task": True, "timeline_consistent": True}
        return json.dumps({
            "problem": problem, "exercise": exercise,
            "turns": [approved, approved] if turn_checks is None else turn_checks,
        })
    return review
