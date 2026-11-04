"""Small in-process abuse guard for costly public endpoints.

This is not a billing quota. It prevents a script from burning the shared
DeepSeek/iFlytek allowance; it is intentionally skipped for SQLite (tests and
local development).
"""

from __future__ import annotations

from collections import OrderedDict, deque
from time import monotonic


class SlidingWindowLimiter:
    def __init__(self, *, max_keys: int = 10_000) -> None:
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()
        self._max_keys = max_keys

    def allow(self, key: str, *, limit: int, window_seconds: int) -> bool:
        now = monotonic()
        cutoff = now - window_seconds
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        self._hits.move_to_end(key)
        while len(self._hits) > self._max_keys:
            self._hits.popitem(last=False)
        return True


limiter = SlidingWindowLimiter()


# Prefixes include the method-agnostic path; callers only count POST/GET traffic.
_AI_PREFIXES = (
    "/api/chat",
    "/api/feedback",
    "/api/hint",
    "/api/turn-correction",
    "/api/custom-scenario",
    "/api/scenario-suggestion",
    "/api/dictionary/lookup",
)
_VOICE_PREFIXES = ("/api/asr", "/api/pronunciation")
_AUTH_PREFIXES = ("/api/auth/login", "/api/auth/register")


def limit_for(path: str) -> tuple[int, int] | None:
    """Return (requests, window seconds) for a costly path."""
    if path.startswith(_AUTH_PREFIXES):
        return 20, 60
    if path.startswith(_VOICE_PREFIXES):
        return 120, 60
    if path.startswith(_AI_PREFIXES):
        return 60, 60
    return None
