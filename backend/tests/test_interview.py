import json

from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services.deepseek import DeepSeekError

client = TestClient(app)


class _Stub:
    def __init__(self, payload: str) -> None:
        self.payload = payload

    async def chat(self, messages, **_kwargs):
        return self.payload


def test_interview_questions():
    payload = json.dumps({"questions": ["Q1?", "Q2?", "Q3?", "Q4?", "Q5?"]})
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.get("/api/interview/questions?n=4")
        assert resp.status_code == 200
        assert resp.json()["questions"] == ["Q1?", "Q2?", "Q3?", "Q4?"]
    finally:
        app.dependency_overrides.clear()


def test_interview_questions_bad_json_502():
    app.dependency_overrides[get_client] = lambda: _Stub("nope")
    try:
        assert client.get("/api/interview/questions").status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_interview_score():
    payload = json.dumps(
        {
            "overall": 5,
            "results": [
                {
                    "question": "Do you prefer studying alone or in a group?",
                    "answer": "I prefer studying alone because...",
                    "score": 5,
                    "level": "Good",
                    "feedback": "表达清晰，可再多举一个例子。",
                    "sample_answer": "Personally, I prefer studying alone...",
                }
            ],
        }
    )
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.post(
            "/api/interview/score",
            json={"items": [{"question": "Do you prefer studying alone or in a group?", "answer": "I prefer studying alone because..."}]},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["overall"] == 5
        assert body["results"][0]["score"] == 5
        assert body["results"][0]["sample_answer"].startswith("Personally")
    finally:
        app.dependency_overrides.clear()


def test_interview_score_computes_overall_when_missing():
    payload = json.dumps(
        {
            "results": [
                {"question": "Q1", "answer": "a", "score": 4, "level": "Fair", "feedback": "ok", "sample_answer": "s"},
                {"question": "Q2", "answer": "b", "score": 6, "level": "Good", "feedback": "ok", "sample_answer": "s"},
            ]
        }
    )
    app.dependency_overrides[get_client] = lambda: _Stub(payload)
    try:
        resp = client.post(
            "/api/interview/score",
            json={"items": [{"question": "Q1", "answer": "a"}, {"question": "Q2", "answer": "b"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["overall"] == 5
    finally:
        app.dependency_overrides.clear()


def test_interview_score_service_error_503():
    class _Boom:
        async def chat(self, messages, **_kwargs):
            raise DeepSeekError("nope")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        resp = client.post(
            "/api/interview/score",
            json={"items": [{"question": "Q1", "answer": "a"}]},
        )
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()
