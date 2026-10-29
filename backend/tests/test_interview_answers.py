"""Trusted video context and bounded spoken samples; no external API calls."""

import asyncio
import copy
import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import interview
from app.api.chat import get_client
from app.data.interview_questions import INSPIRE_PLAYLIST_URL, get_interview_sets
from app.main import app
from app.schemas.interview import InterviewScoreRequest
from app.services.deepseek import DeepSeekError


SAMPLE = (
    "I usually prefer working alone because I can choose my own pace and focus on "
    "the hardest parts first. Last week, I studied in a quiet room and finished my "
    "assignment before dinner. If I get stuck, I ask a friend for help afterward. "
    "That balance gives me independence while still letting me learn from other people."
)


def test_frozen_video_references_have_complete_verified_coverage():
    from app.data.interview_answer_references import load_answer_references
    from app.data.interview_questions import INSPIRE_DATA_PATH

    references = load_answer_references()
    question_rows = json.loads(INSPIRE_DATA_PATH.read_text(encoding="utf-8"))["sets"]
    last_question_starts = {row["id"]: row["question_timestamps"][-1] for row in question_rows}
    assert len(references) == 190
    reviewed = [ref for ref in references.values() if ref.status == "reviewed"]
    missing = [ref for ref in references.values() if ref.status == "not_provided"]
    assert {ref.episode for ref in reviewed} == set(range(17, 191))
    assert {ref.episode for ref in missing} == set(range(1, 17))
    assert sum(len(ref.answers) for ref in reviewed) == 696
    for ref in reviewed:
        times = [sum(int(part) * 60 ** power for power, part in enumerate(reversed(idea.timestamp.split(":")))) for idea in ref.answers]
        assert times == sorted(times)
        assert times[0] > last_question_starts[ref.set_id] + 40
        assert all(8 <= len(idea.notes.split()) <= 30 for idea in ref.answers)


class Responses:
    """Replace only the paid network boundary, retaining messages for inspection."""

    def __init__(self, *responses):
        self.responses = iter(responses)
        self.messages = []

    async def chat(self, messages, **kwargs):
        self.messages.append(messages)
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return json.dumps(response)


@pytest.fixture
def bank(monkeypatch):
    groups = get_interview_sets()[:2]
    monkeypatch.setattr(interview, "get_interview_sets", lambda: groups)
    return groups


@pytest.fixture
def references(bank, monkeypatch):
    document = {
        "playlist_url": INSPIRE_PLAYLIST_URL,
        "reviewed_at": "2026-10-29",
        "sets": [
            {
                "set_id": group.id, "episode": group.episode,
                "source_url": group.source_url,
                "status": "reviewed" if index == 0 else "not_provided",
                "answers": [
                    {"question_index": n, "notes": f"Unique source idea {n}: consider shared study or quiet focus.", "timestamp": f"05:{n:02d}"}
                    for n in range(1, 5)
                ] if index == 0 else [],
                **({"reason": "No sample answer pages in the video."} if index else {}),
            }
            for index, group in enumerate(bank)
        ],
    }
    original_read = Path.read_text

    def read(path, *args, **kwargs):
        if path.name == "inspire_answer_references.json":
            return json.dumps(document)
        return original_read(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read)
    return document


@pytest.fixture
def api():
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def request_for(group, *, identity=True):
    return {
        **({"set_id": group.id} if identity else {}),
        "items": [{"question": q, "answer": "I prefer quiet study. My own example matters."} for q in group.questions],
    }


def result_payload(items, sample=SAMPLE):
    return {"overall": 6, "results": [
        {"question": "model changed question", "answer": "model changed transcript", "score": n,
         "level": "Fair", "feedback": f"Original feedback {n}", "sample_answer": sample,
         "sample_source": "video_reference", "sample_source_url": "https://evil.example/",
         "sample_word_count": 1, "sample_estimated_seconds": 1}
        for n, _item in enumerate(items, 2)
    ]}


def score(api, request, *responses):
    service = Responses(*responses)
    app.dependency_overrides[get_client] = lambda: service
    return api.post("/api/interview/score", json=request), service


def test_reviewed_context_is_used_and_server_owns_source_and_timing(api, bank, references):
    req = request_for(bank[0])
    response, service = score(api, req, result_payload(req["items"]))
    assert response.status_code == 200
    body = response.json()
    assert body["overall"] == 3.5
    for index, (item, result) in enumerate(zip(req["items"], body["results"]), 1):
        assert result["question"] == item["question"]
        assert result["answer"] == item["answer"]
        assert result["sample_source"] == "video_reference"
        assert result["sample_source_url"] == f"{bank[0].source_url}&t={300 + index}"
        assert result["sample_word_count"] == 57
        assert result["sample_estimated_seconds"] == 35
    prompt = "\n".join(message["content"] for message in service.messages[0])
    assert "Unique source idea 1" in prompt and "Unique source idea 4" in prompt
    assert "55–75" in prompt and "45" in prompt
    assert "not a scoring standard" in prompt
    assert "learner's reasonable position" in prompt


@pytest.mark.parametrize("identity", [False, True])
def test_unreviewed_set_uses_ai_and_ignores_forged_model_source(api, bank, references, identity):
    req = request_for(bank[1], identity=identity)
    response, service = score(api, req, result_payload(req["items"]))
    assert response.status_code == 200
    assert all(r["sample_source"] == "ai_generated" and r["sample_source_url"] is None for r in response.json()["results"])
    assert "Unique source idea" not in str(service.messages)


def test_old_client_only_associates_complete_unique_ordered_group(api, bank, references):
    req = request_for(bank[0], identity=False)
    response, _service = score(api, req, result_payload(req["items"]))
    assert response.json()["results"][0]["sample_source"] == "video_reference"


@pytest.mark.parametrize("case", ["partial", "reordered", "manual", "ambiguous"])
def test_old_client_without_unique_complete_match_gets_ai(api, bank, references, monkeypatch, case):
    req = request_for(bank[0], identity=False)
    if case == "partial":
        req["items"].pop()
    elif case == "reordered":
        req["items"].reverse()
    elif case == "manual":
        req["items"] = [{"question": "A manual question?", "answer": "My answer."}]
    else:
        monkeypatch.setattr(interview, "get_interview_sets", lambda: (*bank, replace(bank[0], id="another")))
    response, service = score(api, req, result_payload(req["items"]))
    assert response.status_code == 200
    assert all(r["sample_source"] == "ai_generated" for r in response.json()["results"])
    assert "Unique source idea" not in str(service.messages)


@pytest.mark.parametrize("case", ["unknown", "wrong_set", "reordered", "partial", "empty"])
def test_explicit_bad_identity_is_rejected_before_model_call(api, bank, references, case):
    req = request_for(bank[0])
    if case == "unknown":
        req["set_id"] = "unknown"
    elif case == "wrong_set":
        req["set_id"] = bank[1].id
    elif case == "reordered":
        req["items"].reverse()
    elif case == "partial":
        req["items"].pop()
    else:
        req["set_id"] = ""
    response, service = score(api, req, result_payload(req["items"]))
    assert response.status_code == 422
    assert service.messages == []


def test_questions_and_catalogue_do_not_expose_answer_references(api, bank, references):
    for path in ("/api/interview/sets", f"/api/interview/questions?set_id={bank[0].id}"):
        response = api.get(path)
        assert response.status_code == 200
        assert "Unique source idea" not in response.text
        assert "sample_answer" not in response.text
        assert "answers" not in response.json()


def test_loader_preserves_original_notes_and_validates_alignment(tmp_path, bank, references):
    from app.data.interview_answer_references import load_answer_references

    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(references), encoding="utf-8")
    loaded = load_answer_references(path, sets=bank)
    assert loaded[bank[0].id].answers[0].notes == "Unique source idea 1: consider shared study or quiet focus."
    assert loaded[bank[1].id].status == "not_provided"


@pytest.mark.parametrize("case", ["url", "id", "episode", "duplicate", "missing", "indices", "notes", "timestamp", "reason", "status", "hidden_answers", "playlist", "date"])
def test_loader_rejects_misaligned_or_unverified_sources(tmp_path, bank, references, case):
    from app.data.interview_answer_references import load_answer_references

    document = copy.deepcopy(references)
    row = document["sets"][0]
    if case == "url":
        row["source_url"] = bank[1].source_url
    elif case == "id":
        row["set_id"] = "unknown"
    elif case == "episode":
        row["episode"] = bank[1].episode
    elif case == "duplicate":
        document["sets"].append(copy.deepcopy(row))
    elif case == "missing":
        document["sets"].pop()
    elif case == "indices":
        row["answers"][3]["question_index"] = 3
    elif case == "notes":
        row["answers"][0]["notes"] = " "
    elif case == "timestamp":
        row["answers"][0]["timestamp"] = "05:99"
    elif case == "reason":
        document["sets"][1].pop("reason")
    elif case == "status":
        row["status"] = "assumed"
    elif case == "hidden_answers":
        document["sets"][1]["answers"] = row["answers"]
    elif case == "playlist":
        document["playlist_url"] = "https://evil.example/"
    else:
        document["reviewed_at"] = "yesterday"
    path = tmp_path / "fixture.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError):
        load_answer_references(path, sets=bank)


def test_long_samples_are_repaired_once_without_changing_feedback(api, bank, references):
    req = request_for(bank[0])
    payload = result_payload(req["items"])
    payload["results"][0]["sample_answer"] = " ".join(["word"] * 76)
    payload["results"][2]["sample_answer"] = " ".join(["word"] * 90)
    repair = {"results": [
        {"question_index": 1, "sample_answer": SAMPLE, "score": 0, "feedback": "forged"},
        {"question_index": 3, "sample_answer": SAMPLE},
    ]}
    response, service = score(api, req, payload, repair)
    assert response.status_code == 200
    body = response.json()
    assert body["overall"] == 3.5
    assert [r["score"] for r in body["results"]] == [2, 3, 4, 5]
    assert [r["feedback"] for r in body["results"]] == ["Original feedback 2", "Original feedback 3", "Original feedback 4", "Original feedback 5"]
    assert all(r["sample_answer"] == SAMPLE and r["sample_word_count"] == 57 for r in body["results"])
    assert len(service.messages) == 2
    repair_prompt = "\n".join(message["content"] for message in service.messages[1])
    assert "sample_answer" in repair_prompt
    assert "Original feedback" not in repair_prompt
    assert "Unique source idea 1" in repair_prompt


@pytest.mark.parametrize("failure", ["long", "missing", "duplicate", "extra", "empty", "not_string", "non_object", "network"])
def test_failed_repair_returns_retry_error_without_truncation_or_more_attempts(api, bank, references, failure):
    req = request_for(bank[0])
    payload = result_payload(req["items"])
    payload["results"][0]["sample_answer"] = " ".join(["word"] * 76)
    repaired = {"question_index": 1, "sample_answer": SAMPLE}
    repair = {"results": [repaired]}
    if failure == "long":
        repaired["sample_answer"] = " ".join(["still"] * 76)
    elif failure == "missing":
        repair["results"] = []
    elif failure == "duplicate":
        repair["results"].append(repaired.copy())
    elif failure == "extra":
        repair["results"].append({"question_index": 2, "sample_answer": SAMPLE})
    elif failure == "empty":
        repaired["sample_answer"] = "  "
    elif failure == "not_string":
        repaired["sample_answer"] = 123
    elif failure == "non_object":
        repair = ["unexpected"]
    else:
        repair = DeepSeekError("upstream unavailable")
    response, service = score(api, req, payload, repair)
    assert response.status_code == (503 if failure == "network" else 502)
    assert "results" not in response.json()
    assert len(service.messages) == 2


def test_75_word_boundary_does_not_trigger_compression(api):
    req = {"items": [{"question": "A manual question?", "answer": "My answer."}]}
    sample = " ".join(["word"] * 74 + ["don't"])
    response, service = score(api, req, result_payload(req["items"], sample))
    assert response.status_code == 200
    assert response.json()["results"][0]["sample_word_count"] == 75
    assert response.json()["results"][0]["sample_estimated_seconds"] == 45
    assert len(service.messages) == 1


def test_numbers_contractions_and_hyphens_have_consistent_word_counts(api):
    req = {"items": [{"question": "A manual question?", "answer": "My answer."}]}
    response, _service = score(api, req, result_payload(req["items"], "I don't need a 4-day plan; I’m free at 7."))
    assert response.status_code == 200
    assert response.json()["results"][0]["sample_word_count"] == 11


@pytest.mark.parametrize("payload", [[], None, {"results": "not a list"}])
def test_malformed_score_response_uses_existing_retry_error(api, payload):
    req = {"items": [{"question": "A manual question?", "answer": "My answer."}]}
    response, _service = score(api, req, payload)
    assert response.status_code == 502


def test_scoring_and_repair_can_finish_within_one_budget(monkeypatch):
    monkeypatch.setattr(interview, "_SCORE_BUDGET_SECONDS", 1, raising=False)

    async def scenario():
        started = [asyncio.Event(), asyncio.Event()]
        release = [asyncio.Event(), asyncio.Event()]
        req = {"items": [{"question": "A manual question?", "answer": "My answer."}]}
        payload = result_payload(req["items"], " ".join(["word"] * 76))

        class GatedResponses(Responses):
            async def chat(self, messages, **kwargs):
                index = len(self.messages)
                started[index].set()
                await release[index].wait()
                return await super().chat(messages, **kwargs)

        service = GatedResponses(payload, {"results": [{"question_index": 1, "sample_answer": SAMPLE}]})
        task = asyncio.create_task(interview.interview_score(InterviewScoreRequest(**req), service))
        for index in range(2):
            await asyncio.wait_for(started[index].wait(), timeout=1)
            release[index].set()
        result = await asyncio.wait_for(task, timeout=1)
        assert result.overall == 2
        assert result.results[0].feedback == "Original feedback 2"
        assert result.results[0].sample_answer == SAMPLE
        assert len(service.messages) == 2

    asyncio.run(scenario())


def test_repair_consumes_scoring_deadline_and_is_cancelled_with_retry_503(monkeypatch):
    real_timeout = asyncio.timeout
    scopes = []

    def controlled_timeout(delay):
        scope = real_timeout(delay)
        scopes.append(scope)
        return scope

    monkeypatch.setattr(interview, "timeout", controlled_timeout, raising=False)
    monkeypatch.setattr(interview, "_SCORE_BUDGET_SECONDS", 1, raising=False)

    async def scenario():
        cancelled = asyncio.Event()
        repair_started = asyncio.Event()
        never_release = asyncio.Event()
        calls = []
        req = {"items": [{"question": "A manual question?", "answer": "My answer."}]}

        class ExhaustedBudget:
            async def chat(self, messages, **kwargs):
                calls.append(messages)
                if len(calls) == 1:
                    # Consume the initial scoring scope's remaining budget without
                    # sleeping. A new repair deadline would incorrectly reset it.
                    if scopes:
                        scopes[0].reschedule(asyncio.get_running_loop().time())
                    return json.dumps(result_payload(req["items"], " ".join(["word"] * 76)))
                repair_started.set()
                try:
                    await never_release.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise

        with pytest.raises(HTTPException) as error:
            await asyncio.wait_for(interview.interview_score(InterviewScoreRequest(**req), ExhaustedBudget()), timeout=0.5)
        assert error.value.status_code == 503
        assert repair_started.is_set() and cancelled.is_set()
        assert scopes[0].expired()
        await asyncio.sleep(0)
        assert len(calls) == 2

    asyncio.run(scenario())


def test_external_cancellation_during_scoring_does_not_start_repair():
    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()
        never_release = asyncio.Event()
        calls = []

        class CancelledScoring:
            async def chat(self, messages, **kwargs):
                calls.append(messages)
                started.set()
                try:
                    await never_release.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    raise

        req = InterviewScoreRequest(items=[{"question": "A manual question?", "answer": "My answer."}])
        task = asyncio.create_task(interview.interview_score(req, CancelledScoring()))
        await asyncio.wait_for(started.wait(), timeout=1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        assert cancelled.is_set()
        assert len(calls) == 1

    asyncio.run(scenario())
