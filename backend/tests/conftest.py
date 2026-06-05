"""Point the app at a throwaway SQLite database for the whole test run.

Must run before any `app.*` import so the engine in `app.db` is built against
the temp database rather than the real `spoken.db`.
"""

import os
import tempfile

_fd, _path = tempfile.mkstemp(prefix="spoken_test_", suffix=".db")
os.close(_fd)
os.environ["DATABASE_URL"] = "sqlite:///" + _path.replace(os.sep, "/")

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
