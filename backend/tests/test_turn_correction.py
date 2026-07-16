import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


class _Stub:
    def __init__(self, payload: str) -> None:
        self.payload = payload
        self.calls: list[tuple[list[dict[str, str]], dict]] = []

    async def chat(self, messages, **kwargs):
        self.calls.append((messages, kwargs))
        return self.payload


def _body(**patch):
    body = {
        "scenario_id": "cafe",
        "text": "I very like this coffee",
        "previous_partner_message": "How do you like the coffee?",
    }
    body.update(patch)
    return body


def test_turn_correction_returns_structured_fix_and_context():
    stub = _Stub(
        json.dumps(
            {
                "natural": False,
                "suggestion": "I really like this coffee.",
                "issues": [
                    {
                        "kind": "grammar",
                        "original": "very like",
                        "replacement": "really like",
                        "note": "very 通常不直接修饰动词 like。",
                    }
                ],
                "explanation": "意思清楚，换一个副词会更自然。",
            }
        )
    )
    app.dependency_overrides[get_client] = lambda: stub
    try:
        response = client.post("/api/turn-correction", json=_body())
        assert response.status_code == 200
        body = response.json()
        assert body["original"] == "I very like this coffee"
        assert body["suggestion"] == "I really like this coffee."
        assert body["issues"][0]["kind"] == "grammar"
        prompt = stub.calls[0][0][1]["content"]
        assert "How do you like the coffee?" in prompt
        assert "Ordering at a Café" in prompt
        assert stub.calls[0][1]["response_format"] == {"type": "json_object"}
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_natural_sentence_has_no_issues():
    app.dependency_overrides[get_client] = lambda: _Stub(
        json.dumps(
            {
                "natural": True,
                "suggestion": "I'd like a latte, please.",
                "issues": [
                    {
                        "kind": "expression",
                        "original": "unused",
                        "replacement": "unused",
                        "note": "unused",
                    }
                ],
                "explanation": "表达自然，无需修改。",
            }
        )
    )
    try:
        response = client.post(
            "/api/turn-correction",
            json=_body(text="I'd like a latte, please."),
        )
        assert response.status_code == 200
        assert response.json()["natural"] is True
        assert response.json()["issues"] == []
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_validates_text_and_scenario():
    assert client.post("/api/turn-correction", json=_body(text="   ")).status_code == 422
    assert client.post("/api/turn-correction", json=_body(text="x" * 601)).status_code == 422
    assert client.post(
        "/api/turn-correction",
        json=_body(scenario_id="missing"),
    ).status_code == 404


def test_turn_correction_bad_model_json_maps_to_503():
    app.dependency_overrides[get_client] = lambda: _Stub("not json")
    try:
        assert client.post("/api/turn-correction", json=_body()).status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_turn_correction_service_failure_maps_to_503():
    class _Boom:
        async def chat(self, messages, **kwargs):
            raise DeepSeekError("down")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        assert client.post("/api/turn-correction", json=_body()).status_code == 503
    finally:
        app.dependency_overrides.clear()
