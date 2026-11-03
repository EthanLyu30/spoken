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


def native_end_payload():
    return {"operation": "speech.native_end", "duration_ms": 1200, "reason": "native_error",
            "error_code": "network", "state_at_event": 7, "watchdog_budget_ms": 60_000,
            "pause_count": 2, "resume_count": 1, "paused_duration_ms": 123.5,
            "visibility_state": "hidden"}


def test_native_terminal_contract_is_strict_and_reason_is_operation_specific():
    client = TestClient(app)
    payload = native_end_payload()
    assert client.post("/api/telemetry/client", json=payload).status_code == 202
    assert client.post("/api/telemetry/client", json={"operation": "speech.native_end", "duration_ms": 1, "reason": "end"}).status_code == 202
    assert client.post("/api/telemetry/client", json={"operation": "speech.native_end", "duration_ms": 1}).status_code == 422
    for changes in ({"reason": "started"}, {"reason": "private"}, {"error_code": "private"},
                    {"state_at_event": True}, {"state_at_event": 8}, {"watchdog_budget_ms": True},
                    {"watchdog_budget_ms": 3_600_001}, {"pause_count": 1.5}, {"pause_count": 101},
                    {"resume_count": -1}, {"paused_duration_ms": 300_001}, {"visibility_state": "public"},
                    {"operation": "speech.native_start"}):
        assert client.post("/api/telemetry/client", json={**payload, **changes}).status_code == 422


@pytest.mark.parametrize("field,value", [
    ("reason", "end"), ("state_at_event", 0), ("watchdog_budget_ms", 60_000),
    ("pause_count", 0), ("resume_count", 0), ("paused_duration_ms", 0),
    ("visibility_state", "visible"),
])
def test_native_terminal_fields_are_rejected_on_other_operations(field, value):
    assert TestClient(app).post("/api/telemetry/client", json={
        "operation": "speech.complete", "duration_ms": 1, field: value}).status_code == 422


def asr_attempt_payload():
    return {"operation": "asr.attempt", "duration_ms": 25, "stage": "stream_final", "attempt": 2,
            "fallback_reason": "disconnect", "audio_bytes": 128_000, "result_class": "nonempty"}


@pytest.mark.parametrize("stage", ["authorize", "open", "stream_final", "whole_clip", "http_buffered"])
def test_asr_attempt_contract_accepts_only_known_stages(stage):
    client = TestClient(app)
    payload = {**asr_attempt_payload(), "stage": stage}
    assert client.post("/api/telemetry/client", json=payload).status_code == 202
    without_optional = {k: v for k, v in payload.items() if k not in {"fallback_reason", "result_class"}}
    assert client.post("/api/telemetry/client", json=without_optional).status_code == 202


@pytest.mark.parametrize("changes", [
    {"stage": "private"}, {"attempt": 0}, {"attempt": 11}, {"attempt": True},
    {"fallback_reason": "private"}, {"audio_bytes": -1}, {"audio_bytes": 5_760_001},
    {"audio_bytes": True}, {"result_class": "private"}, {"operation": "asr.finalize"},
])
def test_asr_attempt_contract_rejects_invalid_values_and_cross_operation_fields(changes):
    assert TestClient(app).post("/api/telemetry/client", json={**asr_attempt_payload(), **changes}).status_code == 422


@pytest.mark.parametrize("missing", ["stage", "attempt"])
def test_asr_attempt_requires_its_attempt_identity(missing):
    payload = asr_attempt_payload()
    del payload[missing]
    assert TestClient(app).post("/api/telemetry/client", json=payload).status_code == 422


def test_asr_attempt_requires_audio_size_only_for_complete_clip_attempts():
    client = TestClient(app)
    for stage in ("whole_clip", "http_buffered"):
        payload = asr_attempt_payload()
        payload["stage"] = stage
        del payload["audio_bytes"]
        assert client.post("/api/telemetry/client", json=payload).status_code == 422
    assert client.post("/api/telemetry/client", json={
        "operation": "asr.attempt", "duration_ms": 25, "stage": "open", "attempt": 1}).status_code == 202


def test_native_end_allows_long_watchdogs_without_relaxing_other_operations():
    client = TestClient(app)
    payload = {**native_end_payload(), "duration_ms": 300_001, "watchdog_budget_ms": 3_600_000}
    assert client.post("/api/telemetry/client", json=payload).status_code == 202
    assert client.post("/api/telemetry/client", json={**payload, "duration_ms": 3_600_001}).status_code == 422
    assert client.post("/api/telemetry/client", json={
        "operation": "speech.complete", "duration_ms": 300_001}).status_code == 422


@pytest.mark.parametrize("operation", ["pronunciation.click_to_result", "pronunciation.stop_to_result"])
@pytest.mark.parametrize("entry", ["turn_correction", "follow_read"])
def test_pronunciation_timing_contract(operation, entry):
    client = TestClient(app)
    payload = {"operation": operation, "duration_ms": 800, "entry": entry, "audio_bytes": 64_000}
    assert client.post("/api/telemetry/client", json=payload).status_code == 202
    assert client.post("/api/telemetry/client", json={**payload, "entry": "private"}).status_code == 422
    assert client.post("/api/telemetry/client", json={**payload, "audio_bytes": 5_760_001}).status_code == 422
    assert client.post("/api/telemetry/client", json={k: v for k, v in payload.items() if k != "entry"}).status_code == 422
    assert client.post("/api/telemetry/client", json={k: v for k, v in payload.items() if k != "audio_bytes"}).status_code == 422
    assert client.post("/api/telemetry/client", json={**payload, "stage": "open"}).status_code == 422
    assert client.post("/api/telemetry/client", json={**payload, "operation": "speech.complete"}).status_code == 422
