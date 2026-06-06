"""Point the app at a throwaway SQLite database for the whole test run.

Must run before any `app.*` import so the engine in `app.db` is built against
the temp database rather than the real `spoken.db`.
"""

import atexit
import os
import tempfile

_fd, _path = tempfile.mkstemp(prefix="spoken_test_", suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = "sqlite:///" + _path.replace(os.sep, "/")

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
