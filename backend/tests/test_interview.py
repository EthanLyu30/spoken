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


def test_interview_questions_bank_only():
    from app.data.interview_questions import INDEPENDENT_QUESTIONS

    resp = client.get("/api/interview/questions?n=4&ai=false")
    assert resp.status_code == 200
    qs = resp.json()["questions"]
    assert len(qs) == 4
    assert len(set(qs)) == 4  # no duplicates
    assert all(q in INDEPENDENT_QUESTIONS for q in qs)


def test_interview_questions_use_one_sourced_topic_without_ai():
    app.dependency_overrides[get_client] = lambda: _Stub(
        json.dumps({"questions": ["A fresh scenario question?"]})
    )
    try:
        resp = client.get("/api/interview/questions?n=4")
        assert resp.status_code == 200
        qs = resp.json()["questions"]
        assert len(qs) == 4
        assert "A fresh scenario question?" not in qs
        assert resp.json()["set_id"]
        assert resp.json()["source_url"].startswith("https://")
        assert resp.json()["source_kind"] in {"official_adapted", "video_adapted"}
    finally:
        app.dependency_overrides.clear()


def test_interview_questions_ai_failure_falls_back_to_bank():
    class _Boom:
        async def chat(self, messages, **_kwargs):
            raise DeepSeekError("nope")

    app.dependency_overrides[get_client] = lambda: _Boom()
    try:
        resp = client.get("/api/interview/questions?n=4")
        assert resp.status_code == 200
        assert len(resp.json()["questions"]) == 4  # bank still fills it
    finally:
        app.dependency_overrides.clear()


def test_interview_catalogue_and_selected_set_are_consistent():
    response = client.get("/api/interview/sets")
    assert response.status_code == 200
    sets = response.json()["sets"]
    assert len(sets) >= 4
    for entry in sets:
        assert entry["question_count"] == 4
        assert entry["source_url"].startswith("https://")
        selected = client.get("/api/interview/questions", params={"set_id": entry["id"]}).json()
        assert selected["set_id"] == entry["id"]
        assert selected["topic"] == entry["topic"]
        assert len(selected["questions"]) == len(selected["hints"]) == 4


def test_interview_unknown_set_is_not_silently_replaced():
    assert client.get("/api/interview/questions?set_id=missing").status_code == 404


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


def test_partial_feedback_does_not_silently_drop_unrated_answers():
    payload = {"overall": 4, "results": [{"question": "Q1", "answer": "a", "score": 4, "level": "Fair", "feedback": "ok", "sample_answer": "s"}]}
    app.dependency_overrides[get_client] = lambda: _Stub(json.dumps(payload))
    try:
        response = client.post("/api/interview/score", json={"items": [{"question": "Q1", "answer": "a"}, {"question": "Q2", "answer": "b"}]})
        assert response.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_overall_is_the_actual_average_of_returned_question_scores():
    payload = {"overall": 6, "results": [{"question": "Q1", "answer": "a", "score": 2, "level": "Fair", "feedback": "ok", "sample_answer": "s"}, {"question": "Q2", "answer": "b", "score": 4, "level": "Fair", "feedback": "ok", "sample_answer": "s"}]}
    app.dependency_overrides[get_client] = lambda: _Stub(json.dumps(payload))
    try:
        response = client.post("/api/interview/score", json={"items": [{"question": "Q1", "answer": "a"}, {"question": "Q2", "answer": "b"}]})
        assert response.status_code == 200
        assert response.json()["overall"] == 3
    finally:
        app.dependency_overrides.clear()
