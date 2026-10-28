"""Series loading and the source-filtered interview API contract."""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.data import interview_questions as bank
from app.main import app


def _episode(number: int, video: str) -> dict:
    return {
        "id": "inspire-writing-190" if number == 190 else f"inspire-{number}",
        "episode": number,
        "topic": "写作" if number == 190 else "日常习惯",
        "topic_en": "Writing" if number == 190 else "Daily habits",
        "intro": "You are being interviewed about everyday experiences.",
        "questions": [f"Episode {number}, question {n}?" for n in range(1, 5)],
        "hints": [f"提示 {n}" for n in range(1, 5)],
        "source_title": f"Inspire SpeakEasy · Interview Practice #{number}（改编）",
        "source_url": f"https://www.youtube.com/watch?v={video}",
        "source_kind": "video_adapted",
        "reviewed_at": "2026-10-28",
    }


@pytest.fixture
def series_document():
    return {
        "playlist_url": "https://www.youtube.com/playlist?list=PLfNWEZJODl5iNLcLDJX27jebB_psDCPec",
        "reviewed_at": "2026-10-28",
        "sets": [_episode(1, "abcdefghijk"), _episode(190, "SCGP0s0UmHE")],
    }


@pytest.fixture
def series_file(tmp_path, series_document):
    path = tmp_path / "series.json"
    path.write_text(json.dumps(series_document, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def series_api(monkeypatch, series_file):
    # The loader still reads a real JSON file; only the source path changes.
    monkeypatch.setattr(bank, "INSPIRE_DATA_PATH", series_file, raising=False)
    return TestClient(app)


def test_series_loader_preserves_episode_questions_and_source(series_file):
    groups = bank.load_inspire_sets(series_file)

    assert [group.id for group in groups] == ["inspire-1", "inspire-writing-190"]
    assert [group.episode for group in groups] == [1, 190]
    assert all(group.collection == "inspire" for group in groups)
    assert groups[1].questions == (
        "Episode 190, question 1?", "Episode 190, question 2?",
        "Episode 190, question 3?", "Episode 190, question 4?",
    )
    assert groups[1].source_url == "https://www.youtube.com/watch?v=SCGP0s0UmHE"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("questions", ["Q1?", "Q2?", "Q3?"]),
        ("hints", ["h1", "h2", "h3", "h4", "h5"]),
        ("questions", ["Q1?", "Q2?", "Q3?", "  "]),
        ("questions", ["Q1?", "Q1?", "Q3?", "Q4?"]),
        ("hints", ["h1", "h2", "h3", 4]),
        ("episode", "1"),
        ("episode", True),
        ("episode", 0),
        ("id", "inspire-2"),
        ("source_url", "https://example.org/watch?v=abcdefghijk"),
        ("source_url", "https://www.youtube.com/playlist?list=abcdefghijk"),
        ("source_url", "https://www.youtube.com/watch?v=bad"),
        ("source_url", "http://www.youtube.com/watch?v=abcdefghijk"),
        ("source_kind", "official_adapted"),
        ("reviewed_at", "not-a-date"),
        ("topic", " "),
    ],
)
def test_series_loader_rejects_invalid_episode_fields(tmp_path, series_document, field, value):
    series_document["sets"][0][field] = value
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(series_document), encoding="utf-8")

    with pytest.raises(ValueError, match=field):
        bank.load_inspire_sets(path)


def test_series_loader_rejects_duplicate_ids_and_episodes(tmp_path, series_document):
    series_document["sets"].append(copy.deepcopy(series_document["sets"][0]))
    path = tmp_path / "duplicate.json"
    path.write_text(json.dumps(series_document), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate"):
        bank.load_inspire_sets(path)


@pytest.mark.parametrize("document", [{}, []])
def test_series_loader_rejects_invalid_documents(tmp_path, document):
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError):
        bank.load_inspire_sets(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sets", []), ("sets", "invalid"), ("sets", [None]),
        ("playlist_url", "https://example.org/playlist"),
        ("reviewed_at", "20261028"),
        ("reviewed_at", "2026-13-28"),
    ],
)
def test_series_loader_checks_document_metadata_and_rows(tmp_path, series_document, field, value):
    series_document[field] = value
    path = tmp_path / "invalid.json"
    path.write_text(json.dumps(series_document), encoding="utf-8")

    with pytest.raises(ValueError, match=field):
        bank.load_inspire_sets(path)


def test_short_youtube_links_are_valid_video_sources(series_file, series_document):
    series_document["sets"][0]["source_url"] = "https://youtu.be/abcdefghijk"
    series_file.write_text(json.dumps(series_document), encoding="utf-8")

    assert bank.load_inspire_sets(series_file)[0].source_url == "https://youtu.be/abcdefghijk"


def test_missing_series_is_not_silently_replaced_by_ets(tmp_path):
    with pytest.raises(FileNotFoundError):
        bank.load_inspire_sets(tmp_path / "missing.json")


def test_series_loader_rejects_malformed_json(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text('{"sets": [', encoding="utf-8")

    with pytest.raises(ValueError):
        bank.load_inspire_sets(path)


def test_series_loader_can_retry_after_missing_data_appears(monkeypatch, tmp_path, series_document):
    path = tmp_path / "late.json"
    monkeypatch.setattr(bank, "INSPIRE_DATA_PATH", path, raising=False)

    with pytest.raises(FileNotFoundError):
        bank.get_interview_sets()

    path.write_text(json.dumps(series_document), encoding="utf-8")
    assert len(bank.get_interview_sets()) == 7


def test_catalogue_identifies_both_collections_without_leaking_questions(series_api):
    response = series_api.get("/api/interview/sets")

    assert response.status_code == 200
    entries = response.json()["sets"]
    assert len(entries) == 7
    assert [(entry["id"], entry["episode"]) for entry in entries if entry["collection"] == "inspire"] == [
        ("inspire-1", 1), ("inspire-writing-190", 190),
    ]
    assert len([entry for entry in entries if entry["collection"] == "ets"]) == 5
    assert all(entry["episode"] is None for entry in entries if entry["collection"] == "ets")
    assert all("questions" not in entry and "hints" not in entry for entry in entries)


@pytest.mark.parametrize("source", [None, "inspire", "ets", "all"])
def test_random_questions_are_a_complete_set_from_the_selected_source(series_api, monkeypatch, source):
    selected_ids = []

    def select_last(groups):
        selected_ids.extend(group.id for group in groups)
        return groups[-1]

    monkeypatch.setattr("app.api.interview.random.choice", select_last)
    params = {"n": 1, "ai": "true"}
    if source is not None:
        params["source"] = source
    response = series_api.get("/api/interview/questions", params=params)

    assert response.status_code == 200
    body = response.json()
    assert len(body["questions"]) == len(body["hints"]) == 4
    if source in (None, "inspire"):
        assert selected_ids == ["inspire-1", "inspire-writing-190"]
        assert body["set_id"] == "inspire-writing-190"
        assert body["collection"] == "inspire"
        assert body["episode"] == 190
        assert body["questions"] == [f"Episode 190, question {n}?" for n in range(1, 5)]
    elif source == "ets":
        assert selected_ids == ["work-life-balance", "exercise-habits", "career-choices", "food-preferences", "urban-life"]
        assert body["collection"] == "ets"
        assert body["episode"] is None
    else:
        assert selected_ids == ["inspire-1", "inspire-writing-190", "work-life-balance", "exercise-habits", "career-choices", "food-preferences", "urban-life"]


def test_explicit_ets_set_id_keeps_legacy_selection_working(series_api):
    response = series_api.get("/api/interview/questions", params={"set_id": "work-life-balance"})

    assert response.status_code == 200
    assert response.json()["set_id"] == "work-life-balance"
    assert response.json()["collection"] == "ets"


def test_invalid_source_is_rejected_even_for_explicit_sets(series_api):
    response = series_api.get("/api/interview/questions", params={"source": "other", "set_id": "work-life-balance"})

    assert response.status_code == 422


def test_unknown_set_is_not_replaced_when_source_is_valid(series_api):
    response = series_api.get("/api/interview/questions", params={"source": "ets", "set_id": "missing"})

    assert response.status_code == 404


def test_broken_data_is_not_replaced_by_ets_or_a_previously_loaded_bank(series_api, series_file):
    assert series_api.get("/api/interview/sets").status_code == 200
    series_file.write_text('{"sets": [', encoding="utf-8")

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/api/interview/sets").status_code == 500
        assert client.get("/api/interview/questions?source=ets").status_code == 500
