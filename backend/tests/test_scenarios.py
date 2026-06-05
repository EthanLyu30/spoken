from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EXPECTED_IDS = {"interview", "cafe", "standup", "airport", "doctor", "party"}


def test_list_scenarios_returns_catalogue():
    resp = client.get("/api/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert {s["id"] for s in data} == EXPECTED_IDS


def test_public_scenario_hides_internal_persona():
    data = client.get("/api/scenarios").json()
    for scenario in data:
        assert "persona" not in scenario
        assert scenario["opening_line"]
        assert scenario["partner_role"]


def test_get_single_scenario():
    resp = client.get("/api/scenarios/cafe")
    assert resp.status_code == 200
    assert resp.json()["id"] == "cafe"


def test_unknown_scenario_returns_404():
    resp = client.get("/api/scenarios/does-not-exist")
    assert resp.status_code == 404
