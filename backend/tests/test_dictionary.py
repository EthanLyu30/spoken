import json

import pytest
from fastapi.testclient import TestClient

from app.api.chat import get_client
from app.main import app
from app.services import dictionary as dictionary_service

client = TestClient(app)


class _Stub:
    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, **kwargs):
        self.calls += 1
        return json.dumps(
            {
                "phonetic": "",
                "part_of_speech": "phrasal verb",
                "meaning": "偶然遇见；碰到",
                "example": "I ran into an old friend at the station.",
                "example_zh": "我在车站偶遇了一位老朋友。",
            }
        )


@pytest.fixture(autouse=True)
def _clear_cache():
    dictionary_service.clear_dictionary_cache()
    yield
    dictionary_service.clear_dictionary_cache()


def test_dictionary_normalizes_phrase_and_returns_entry():
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        response = client.post(
            "/api/dictionary/lookup",
            json={"query": "  run   into, "},
        )
        assert response.status_code == 200
        assert response.json() == {
            "query": "run into",
            "phonetic": "",
            "part_of_speech": "phrasal verb",
            "meaning": "偶然遇见；碰到",
            "example": "I ran into an old friend at the station.",
            "example_zh": "我在车站偶遇了一位老朋友。",
        }
    finally:
        app.dependency_overrides.clear()


def test_dictionary_cache_uses_case_insensitive_key():
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        assert (
            client.post(
                "/api/dictionary/lookup",
                json={"query": "Run Into"},
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/dictionary/lookup",
                json={"query": "run into"},
            ).status_code
            == 200
        )
        assert stub.calls == 1
    finally:
        app.dependency_overrides.clear()


def test_dictionary_cache_expires(monkeypatch):
    now = 100.0
    monkeypatch.setattr(dictionary_service, "_now", lambda: now)
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        client.post("/api/dictionary/lookup", json={"query": "run into"})
        now += 86_401
        client.post("/api/dictionary/lookup", json={"query": "run into"})
        assert stub.calls == 2
    finally:
        app.dependency_overrides.clear()


def test_dictionary_cache_evicts_the_least_recently_used_entry(monkeypatch):
    monkeypatch.setattr(dictionary_service, "_CACHE_MAX", 2)
    stub = _Stub()
    app.dependency_overrides[get_client] = lambda: stub
    try:
        client.post("/api/dictionary/lookup", json={"query": "coffee"})
        client.post("/api/dictionary/lookup", json={"query": "latte"})
        client.post("/api/dictionary/lookup", json={"query": "coffee"})
        client.post("/api/dictionary/lookup", json={"query": "airport"})
        client.post("/api/dictionary/lookup", json={"query": "latte"})
        assert stub.calls == 4
    finally:
        app.dependency_overrides.clear()


def test_dictionary_rejects_invalid_queries():
    assert (
        client.post(
            "/api/dictionary/lookup",
            json={"query": "123"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/dictionary/lookup",
            json={"query": "one two three four five six seven"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/dictionary/lookup",
            json={"query": "x" * 81},
        ).status_code
        == 422
    )


def test_dictionary_bad_model_json_maps_to_503():
    class _BadJson:
        async def chat(self, messages, **kwargs):
            return "not json"

    app.dependency_overrides[get_client] = lambda: _BadJson()
    try:
        response = client.post(
            "/api/dictionary/lookup",
            json={"query": "coffee"},
        )
        assert response.status_code == 503
    finally:
        app.dependency_overrides.clear()
