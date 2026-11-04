from fastapi.testclient import TestClient

from app.core.ratelimit import SlidingWindowLimiter, limit_for
from app.main import app


def test_costly_path_rules_cover_ai_voice_and_auth():
    assert limit_for("/api/chat/stream") == (60, 60)
    assert limit_for("/api/asr") == (120, 60)
    assert limit_for("/api/auth/login") == (20, 60)
    assert limit_for("/api/health") is None


def test_sliding_window_rejects_after_limit():
    limiter = SlidingWindowLimiter()
    assert limiter.allow("client", limit=2, window_seconds=60)
    assert limiter.allow("client", limit=2, window_seconds=60)
    assert not limiter.allow("client", limit=2, window_seconds=60)
    assert limiter.allow("another", limit=2, window_seconds=60)


def test_api_sets_basic_security_headers():
    response = TestClient(app).get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
