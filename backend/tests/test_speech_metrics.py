import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.mark.parametrize("operation", ["speech.voice_resolution", "speech.final_text_to_audio",
                                      "speech.native_start", "speech.cloud_fetch", "speech.play_start"])
def test_speech_stage_metrics_accept_only_numeric_content_free_payload(operation):
    client = TestClient(app)
    payload = {"operation": operation, "duration_ms": 125.5, "engine": "browser", "interaction_id": "a" * 32}
    assert client.post("/api/telemetry/client", json=payload).status_code == 202
    assert client.post("/api/telemetry/client", json={**payload, "text": "private"}).status_code == 422
    assert client.post("/api/telemetry/client", json={**payload, "duration_ms": -1}).status_code == 422


def test_arbitrary_speech_metric_names_are_not_accepted():
    assert TestClient(app).post("/api/telemetry/client", json={"operation": "speech.private-text", "duration_ms": 1}).status_code == 422
