from fastapi.testclient import TestClient

from app.main import app


def test_cors_preflight_is_cacheable_for_a_day():
    response = TestClient(app).options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-max-age"] == "86400"
