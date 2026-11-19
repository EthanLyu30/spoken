import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from app import db as database
from app.api.chat import get_client
from app.main import app
from app.models.progress import LearningEvent
from app.models.session import PracticeSession
from app.schemas.feedback import Correction
from app.services.coaching import _pattern_counts

client = TestClient(app, headers={"X-Client-Id": "test-session-device"})


def _payload():
    return {
        "scenario_id": "cafe",
        "messages": [
            {"role": "assistant", "content": "Hi! What can I get you?"},
            {"role": "user", "content": "A latte please."},
        ],
        "overall": 84,
        "summary": "Nice work!",
        "tip": "Keep it up.",
        "scores": [
            {"key": "fluency", "label_en": "Fluency", "label_zh": "流利度", "score": 82},
            {"key": "grammar", "label_en": "Grammar", "label_zh": "语法", "score": 80},
        ],
    }


def test_save_then_get_session():
    resp = client.post("/api/sessions", json=_payload())
    assert resp.status_code == 201
    body = resp.json()
    sid = body["id"]
    assert body["scenario_id"] == "cafe"
    assert len(body["messages"]) == 2

    got = client.get(f"/api/sessions/{sid}")
    assert got.status_code == 200
    detail = got.json()
    assert detail["overall"] == 84
    assert detail["scores"][0]["key"] == "fluency"
    assert detail["messages"][1]["content"] == "A latte please."


def test_list_sessions_returns_saved():
    client.post("/api/sessions", json=_payload())
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1
    assert {"id", "scenario_id", "overall", "created_at"} <= set(rows[0].keys())


def test_unscored_conversation_preserves_marks_without_changing_the_score_and_upgrades_in_place():
    owner = TestClient(app, headers={"X-Client-Id": "unscored-practice-owner"})
    previous = owner.post("/api/sessions", json=_payload()).json()
    mark = {"original": "A latte please.", "suggestion": "", "note": "", "marked": True,
            "self_marked": True, "turn_index": 1}
    payload = {**_payload(), "client_session_id": "retry-report", "overall": None,
               "summary": "", "tip": "", "scores": [], "corrections": [mark]}
    written = owner.post("/api/sessions", json=payload)
    assert written.status_code == 201
    saved = written.json()
    sid = saved["id"]
    assert saved["overall"] is None and saved["client_session_id"] == "retry-report"
    assert saved["messages"] == payload["messages"]
    assert saved["corrections"] == [{**mark, "category": None}]
    assert owner.get(f"/api/sessions/{sid}").json() == saved
    assert owner.get("/api/sessions").json()[0]["overall"] is None
    progress = owner.get("/api/progress/sessions").json()
    assert [session["overall"] for session in progress["sessions"]] == [None, 84]
    assert progress["latest"]["id"] == previous["id"]
    with Session(database.engine) as db:
        receipt = db.scalar(select(LearningEvent).where(LearningEvent.source_id == sid, LearningEvent.event_type == "session"))
        assert receipt.score is None
        original_key = receipt.event_key

    # Zero is a legitimate score when a report actually produced it.
    grade = {**_payload(), "client_session_id": "retry-report", "overall": 0}
    upgraded = owner.post("/api/sessions", json=grade).json()
    assert upgraded["id"] == sid and upgraded["created_at"] == saved["created_at"] and upgraded["overall"] == 0
    assert upgraded["corrections"] == saved["corrections"]
    assert owner.post("/api/sessions", json=payload).json()["overall"] == 0
    assert owner.get("/api/progress/sessions").json()["latest"]["id"] == sid
    with Session(database.engine) as db:
        receipts = db.scalars(select(LearningEvent).where(LearningEvent.source_id == sid, LearningEvent.event_type == "session")).all()
        assert [(receipt.event_key, receipt.score) for receipt in receipts] == [(original_key, 0)]


def test_concurrent_score_retries_return_one_score_and_leave_the_original_practice_count():
    owner = TestClient(app, headers={"X-Client-Id": "parallel-score-owner"})
    draft = {**_payload(), "client_session_id": "same-draft", "overall": None, "scores": []}
    saved = owner.post("/api/sessions", json=draft).json()
    with Session(database.engine) as db:
        original = db.scalar(select(LearningEvent).where(LearningEvent.client_session_id == "same-draft"))
        # A pruned SQLite session's primary key may be reused by a new session.
        db.add(LearningEvent(event_key="expired-older-draft", client_id=original.client_id,
                             event_type="session", source_id=original.source_id, client_session_id="archived-draft",
                             score=43, occurred_at=original.occurred_at, scenario_id=original.scenario_id))
        db.commit()
    before = owner.get("/api/stats").json()

    def score(value):
        return owner.post("/api/sessions", json={**_payload(), "client_session_id": "same-draft", "overall": value})

    with ThreadPoolExecutor(2) as pool:
        first, second = list(pool.map(score, [68, 94]))
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    chosen = first.json()["overall"]
    assert chosen in {68, 94}
    assert owner.get(f"/api/sessions/{saved['id']}").json()["overall"] == chosen
    assert owner.post("/api/sessions", json=draft).json()["overall"] == chosen
    after = owner.get("/api/stats").json()
    for field in ("total_sessions", "today_count", "xp", "streak_days"):
        assert after[field] == before[field]
    with Session(database.engine) as db:
        rows = db.scalars(select(LearningEvent).where(LearningEvent.client_session_id.in_(["same-draft", "archived-draft"]))).all()
        assert {row.client_session_id: row.score for row in rows} == {"same-draft": chosen, "archived-draft": 43}


def test_saved_sentence_marks_drive_owner_scoped_repeated_focus():
    owner = TestClient(app, headers={"X-Client-Id": "correction-focus-owner"})
    other = TestClient(app, headers={"X-Client-Id": "correction-focus-other"})
    payload = _payload()
    payload["messages"][1]["content"] = "I would like latte please."
    mark = {"original": "latte", "suggestion": "a latte", "note": "可数名词前加 a",
            "category": "articles", "turn_index": 1, "marked": True}
    payload["corrections"] = [mark, {**mark, "suggestion": "a large latte"}, {**mark, "turn_index": 0}]
    first = owner.post("/api/sessions", json={**payload, "client_session_id": "repeat-1"})
    assert first.status_code == 201
    sid = first.json()["id"]
    assert owner.get(f"/api/sessions/{sid}").json()["corrections"] == [{**mark, "self_marked": False}]
    assert owner.get("/api/progress/sessions").json()["correction_focus"] == []
    assert other.post("/api/sessions", json=payload).status_code == 201
    assert owner.get("/api/progress/sessions").json()["correction_focus"] == []
    assert owner.post("/api/sessions", json={**payload, "client_session_id": "repeat-2"}).status_code == 201
    assert owner.get("/api/progress/sessions").json()["correction_focus"] == [
        {"category": "articles", "sessions": 2, "turns": 2, "scenario_id": "cafe"},
    ]
    assert other.get(f"/api/sessions/{sid}").status_code == 404


def test_get_missing_session_returns_404():
    assert client.get("/api/sessions/999999").status_code == 404


def test_custom_replay_reads_the_original_scene_for_each_saved_session():
    owner = TestClient(app, headers={"X-Client-Id": "custom-replay-owner"})
    other = TestClient(app, headers={"X-Client-Id": "custom-replay-stranger"})
    repair = {"title": "Bike repair", "title_zh": "修自行车", "partner_role": "Bike mechanic",
              "goal": "Ask how much a repair costs", "persona": "Owns a bike shop", "opening_line": "What's broken?"}
    museum = {**repair, "title": "Museum tickets", "title_zh": "买门票", "goal": "Buy a ticket"}
    first = owner.post("/api/sessions", json={**_payload(), "scenario_id": "custom", "custom": repair,
                                               "client_session_id": "custom-replay-first"})
    assert first.status_code == 201
    assert owner.post("/api/sessions", json={**_payload(), "scenario_id": "custom", "custom": museum}).status_code == 201
    url = f"/api/sessions/{first.json()['id']}"
    assert owner.get(url).json()["custom"]["title"] == "Bike repair"
    assert other.get(url).status_code == 404


def test_legacy_invalid_corrections_do_not_hide_the_session_or_valid_marks():
    owner = TestClient(app, headers={"X-Client-Id": "legacy-coaching-read-owner"})
    mark = {"original": "latte", "suggestion": "a latte", "note": "Use an article.",
            "category": "articles", "turn_index": 1, "marked": True}
    saved = owner.post("/api/sessions", json={**_payload(), "corrections": [mark]})
    assert saved.status_code == 201
    session_id = saved.json()["id"]
    with Session(database.engine) as db:
        session = db.get(PracticeSession, session_id)
        session.corrections = [None, {"original": "old"}, {**mark, "category": "old-category"}, mark]
        db.commit()
    detail = owner.get(f"/api/sessions/{session_id}")
    assert detail.status_code == 200
    assert detail.json()["corrections"] == [{**mark, "self_marked": False}]
    coaching = owner.get("/api/progress/coaching")
    assert coaching.status_code == 200
    assert coaching.json()["examples"][0]["corrections"] == detail.json()["corrections"]
    assert owner.get("/api/progress/sessions").status_code == 200


@pytest.mark.skipif(database.engine.dialect.name != "postgresql", reason="requires PostgreSQL DDL locks")
def test_postgres_migrates_legacy_sessions_from_concurrent_startups(monkeypatch):
    test_engine = database.engine
    schema = f"session_migration_{uuid4().hex}"
    with test_engine.begin() as conn:
        conn.exec_driver_sql(f"CREATE SCHEMA {schema}")
    legacy = create_engine(test_engine.url, connect_args={"options": f"-c search_path={schema}"})
    try:
        with legacy.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE sessions (id INTEGER PRIMARY KEY, client_id VARCHAR(64), "
                                 "scenario_id VARCHAR(64), overall INTEGER, summary TEXT, tip TEXT, created_at TIMESTAMP)")
            conn.exec_driver_sql("INSERT INTO sessions (id, client_id, scenario_id, overall, created_at) "
                                 "VALUES (1, 'legacy-owner', 'custom', 82, CURRENT_TIMESTAMP)")
        with monkeypatch.context() as migration:
            migration.setattr(database, "engine", legacy)
            with ThreadPoolExecutor(max_workers=2) as workers:
                migrations = [workers.submit(database._migrate_session_identity) for _ in range(2)]
                for future in migrations:
                    future.result(timeout=20)
        with Session(legacy) as session:
            previous = session.get(PracticeSession, 1)
            assert previous.overall == 82 and previous.client_session_id is None
            assert previous.custom is None and previous.corrections == []
            previous.custom = {"title": "Museum tickets"}
            session.commit()
            assert session.get(PracticeSession, 1).custom == {"title": "Museum tickets"}
        assert any(index["name"] == "uq_sessions_owner_practice" and index["unique"]
                   for index in inspect(legacy).get_indexes("sessions", schema=schema))
    finally:
        legacy.dispose()
        with test_engine.begin() as conn:
            conn.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")


@pytest.mark.parametrize(("original", "suggestion", "expected"), [
    ("a ticket", "the ticket", {"article_choice": 1}),
    ("I collect the seashells", "I collect seashells", {"article_extra": 1}),
    ("I need ticket and have suitcase", "I need a ticket and have a suitcase", {"article_missing": 2}),
    ("I need umberlla", "I need an umbrella", {"article_missing": 1}),
    ("I saw a dogs and a cat", "I saw dogs and the cat", {"article_extra": 1, "article_choice": 1}),
    ("我要托运行李", "I need to check a bag", {"articles": 1}),
    ("I need 请开门", "I need the door to open", {"articles": 1}),
    ("我想买a ticket", "I'd like to buy a ticket", {"articles": 1}),
    ("我想买ticket", "I'd like to buy a ticket", {"article_missing": 1}),
    ("There is problem", "There is a problem", {"article_missing": 1}),
    ("I asked someone", "I called a mechanic", {"articles": 1}),
])
def test_article_subtypes_require_an_identifiable_english_edit(original, suggestion, expected):
    assert _pattern_counts(Correction(original=original, suggestion=suggestion, note="", category="articles")) == expected


def test_self_mark_and_distinct_article_errors_are_available_as_private_examples():
    owner = TestClient(app, headers={"X-Client-Id": "personal-coaching-owner"})
    other = TestClient(app, headers={"X-Client-Id": "personal-coaching-other"})
    payload = _payload()
    sentence = "I need boarding pass and have suitcase."
    payload["scenario_id"] = "airport"
    payload["messages"][1]["content"] = sentence
    mark = {"original": sentence, "suggestion": "", "note": "", "turn_index": 1,
            "marked": True, "self_marked": True}
    fix = {"original": "boarding pass", "suggestion": "a boarding pass", "note": "加冠词",
           "category": "articles", "turn_index": 1, "marked": True}
    payload["corrections"] = [mark, {**mark, "original": "boarding pass"}, fix,
                              {**fix, "original": sentence, "suggestion": "I need a boarding pass and have a suitcase."}]
    saved = owner.post("/api/sessions", json=payload).json()
    assert [item["original"] for item in saved["corrections"] if item.get("self_marked")] == [sentence]
    coaching = owner.get("/api/progress/coaching").json()
    assert coaching["examples"][0]["original"] == sentence
    assert coaching["examples"][0]["session_id"] == saved["id"]
    assert coaching["examples"][0]["previous_partner_message"] == payload["messages"][0]["content"]
    assert coaching["patterns"] == [{"kind": "article_missing", "category": "articles", "sessions": 1,
                                      "sentences": 1, "occurrences": 2}]
    assert owner.get("/api/progress/coaching", params={"scene": "cafe"}).json()["examples"] == []
    assert owner.get("/api/progress/coaching", params={"scene": "airport"}).json()["examples"] == coaching["examples"]
    empty = other.get("/api/progress/coaching").json()
    assert empty["examples"] == empty["patterns"] == []


@pytest.mark.parametrize(("sentence", "rewrite", "occurrences"), [
    ("我想买ticket，另外 I need a map.", "I'd like a ticket, and I need a map.", 1),
    ("I need ticket. Can I get ticket here?", "I need a ticket. Can I get a ticket here?", 2),
    ("I need ticket for tomorrow.", "I need a ticket for tomorrow.", 1),
])
def test_overlapping_article_quotes_count_only_the_distinct_edits(sentence, rewrite, occurrences):
    owner = TestClient(app, headers={"X-Client-Id": f"article-overlap-{occurrences}-{len(sentence)}"})
    payload = _payload()
    payload["messages"][1]["content"] = sentence
    fix = {"original": "ticket", "suggestion": "a ticket", "note": "补冠词", "category": "articles", "turn_index": 1}
    payload["corrections"] = [fix, {**fix, "original": sentence, "suggestion": rewrite}]
    assert owner.post("/api/sessions", json=payload).status_code == 201
    assert owner.get("/api/progress/coaching").json()["patterns"] == [
        {"kind": "article_missing", "category": "articles", "sessions": 1, "sentences": 1, "occurrences": occurrences},
    ]


def _coaching_plan_response():
    return {
        "summary": "借一件未指定的东西时，在单数可数名词前加 a 或 an。",
        "evidence": [1],
        "scene": {
            "title": "Borrow camping gear", "title_zh": "借露营装备", "partner_role": "Gear rental clerk",
            "goal": "在装备柜台借两样路上用得着的东西。", "persona": "You work at a gear rental desk.",
            "opening_line": "Are you all set for your hike?",
            "practice_cues": [{"keyword": "Could I borrow…?", "meaning": "开口借一件装备",
                               "sentence": "Could I borrow a sleeping bag?"}],
            "practice_exercises": [
                {"partner_line": "Which item would you like for the hike?",
                 "task": "借一支手电筒，用 a 或 an 介绍这件东西。", "hint": "Could I borrow ___?",
                 "example": "Could I borrow a flashlight?"},
                {"partner_line": "Do you need anything in case it gets cold?",
                 "task": "再借一条应急毯，带上合适的不定冠词。", "hint": "I'd also like ___, please.",
                 "example": "I'd also like an emergency blanket, please."},
            ],
        },
    }


def test_session_round_trips_both_coaching_exercises_and_rejects_a_truncated_lesson():
    owner = TestClient(app, headers={"X-Client-Id": "coaching-lesson-history-owner"})
    other = TestClient(app, headers={"X-Client-Id": "coaching-lesson-history-stranger"})
    scene = _coaching_plan_response()["scene"]
    scene["practice_exercises"][0]["target"] = {
        "kind": "indefinite", "instruction": "Use a or an.", "form": "", "context": "",
    }
    payload = {**_payload(), "scenario_id": "custom", "custom": scene}
    saved = owner.post("/api/sessions", json=payload)
    assert saved.status_code == 201
    url = f"/api/sessions/{saved.json()['id']}"
    exercises = owner.get(url).json()["custom"]["practice_exercises"]
    assert len(exercises) == 2
    assert exercises[0] == scene["practice_exercises"][0]
    assert exercises[1]["partner_line"] == scene["practice_exercises"][1]["partner_line"]
    assert other.get(url).status_code == 404
    scene["practice_exercises"].pop()
    assert owner.post("/api/sessions", json=payload).status_code == 422


def test_plan_summary_quotes_the_correction_that_supports_its_exercises(monkeypatch):
    from unittest.mock import AsyncMock

    from app.schemas.coaching import CoachingExample, CoachingPattern, CoachingPlanDraft, CoachingSnapshot
    from app.services import coaching

    unrelated = CoachingExample(session_id=1, turn_index=1, scenario_id="cafe", original="A latte please.",
                                corrections=[Correction(original="latte", suggestion="coffee", note="Different noun", category="word_choice")])
    supporting = CoachingExample(session_id=2, turn_index=1, scenario_id="cafe", original="I need umbrella.",
                                 corrections=[Correction(original="umbrella", suggestion="an umbrella", note="Article", category="articles")])
    sample = _coaching_plan_response()
    sample["evidence"] = [1, 2]
    draft = CoachingPlanDraft.model_validate(sample)
    focus = CoachingPattern(kind="article_missing", category="articles", sessions=1, sentences=1, occurrences=1)
    snapshot = CoachingSnapshot(revision="sample", examples=[unrelated, supporting], patterns=[focus])
    # Isolate citation matching. Exercise checks are covered by the content suite.
    monkeypatch.setattr(coaching, "_check_exercises", lambda *_: None)
    monkeypatch.setattr(coaching, "_review_plan", AsyncMock())
    plan = asyncio.run(coaching._checked_plan(draft, snapshot, [unrelated, supporting], [], None))
    assert "「umbrella」改成了「an umbrella」" in plan.summary
    assert [example.session_id for example in plan.evidence] == [2]


@pytest.mark.parametrize(("source", "flaw"), [
    (11, "malformed cues"), (12, "answer in preview"), (13, "old sentence again"), (14, "example misses the task"),
    (15, "hint does not fit the answer"),
])
def test_coaching_plan_uses_the_callers_examples_and_retries_unusable_exercises(monkeypatch, coaching_review_json, source, flaw):
    owner = TestClient(app, client=(f"192.0.2.{source}", 50000), headers={"X-Client-Id": f"coaching-plan-owner-{source}"})
    someone_else = TestClient(app, client=(f"192.0.2.{source}", 50000), headers={"X-Client-Id": f"coaching-plan-stranger-{source}"})
    sentence = "I need umbrella."
    payload = _payload()
    payload["messages"][1]["content"] = sentence
    payload["corrections"] = [{"original": "umbrella", "suggestion": "an umbrella", "note": "补一个 an",
                               "category": "articles", "turn_index": 1}]
    assert owner.post("/api/sessions", json=payload).status_code == 201
    response = _coaching_plan_response()
    invalid = _coaching_plan_response()
    if flaw == "malformed cues":
        invalid["scene"]["practice_cues"] = ["Could I borrow a sleeping bag?"]
    elif flaw == "answer in preview":
        invalid["scene"]["practice_cues"][0]["sentence"] = "Could I borrow a flashlight?"
    elif flaw == "old sentence again":
        invalid["scene"]["practice_exercises"][0]["example"] = "I need an umbrella."
    elif flaw == "hint does not fit the answer":
        invalid["scene"]["practice_exercises"][0]["hint"] = "I'd like ___ to take home."
    else:
        invalid["scene"]["practice_exercises"][0]["example"] = "Could I borrow a tent?"
    seen = []
    reviewed = []

    class Coach:
        async def chat(self, messages, **kwargs):
            content = json.loads(messages[-1]["content"])
            if "lesson" in content:
                reviewed.append(content)
                example = content["lesson"]["scene"]["practice_exercises"][0]["example"]
                if example == "Could I borrow a tent?":
                    return coaching_review_json(problem="task", exercise=1)
                return coaching_review_json()
            seen.append(content)
            return json.dumps(invalid if len(seen) == 1 else response)

    monkeypatch.setitem(app.dependency_overrides, get_client, Coach)
    owner_revision = owner.get("/api/progress/coaching").json()["revision"]
    stranger_revision = someone_else.get("/api/progress/coaching").json()["revision"]
    plan_url = "/api/progress/coaching/plan"
    assert owner.post(plan_url).status_code == 422
    assert someone_else.post(plan_url, params={"revision": owner_revision}).status_code == 409
    assert someone_else.post(plan_url, params={"revision": stranger_revision}).status_code == 400
    assert seen == []
    result = owner.post(plan_url, params={"revision": owner_revision})
    assert result.status_code == 200
    assert len(seen) == 2
    assert len(reviewed) == (2 if flaw == "example misses the task" else 1)
    assert reviewed[-1]["evidence"][0]["sentence"] == sentence
    assert seen[0]["examples"][0]["sentence"] == sentence
    assert result.json()["evidence"][0]["original"] == sentence
    exercises = result.json()["scene"]["practice_exercises"]
    assert [{key: value for key, value in exercise.items() if key != "target"} for exercise in exercises] == response["scene"]["practice_exercises"]
    assert all(exercise["target"]["kind"] == "indefinite" for exercise in exercises)
    assert result.json()["focus"]["sessions"] == 1
    response["summary"] = "你经常漏掉冠词。"
    assert "经常" not in owner.post(plan_url, params={"revision": owner_revision}).json()["summary"]
    response["evidence"] = [10]
    assert owner.post(plan_url, params={"revision": owner_revision}).status_code == 503


def test_coaching_plan_rejects_a_revision_that_changes_while_the_model_is_running(monkeypatch, coaching_review_json):
    owner = TestClient(app, client=("192.0.2.10", 50000), headers={"X-Client-Id": "coaching-revision-owner"})
    payload = _payload()
    payload["messages"][1]["content"] = "I need umbrella."
    payload["corrections"] = [{"original": "umbrella", "suggestion": "an umbrella", "note": "补冠词",
                               "category": "articles", "turn_index": 1}]
    assert owner.post("/api/sessions", json=payload).status_code == 201
    snapshot = owner.get("/api/progress/coaching").json()
    revision = snapshot["revision"]
    calls = []

    class Coach:
        async def chat(self, messages, **_kwargs):
            if "lesson" in json.loads(messages[-1]["content"]):
                return coaching_review_json()
            calls.append(True)
            assert owner.post("/api/sessions", json=payload).status_code == 201
            return json.dumps(_coaching_plan_response())

    monkeypatch.setitem(app.dependency_overrides, get_client, Coach)
    url = f"/api/progress/coaching/plan?revision={revision}"
    assert owner.post(url).status_code == 409
    assert calls == [True]
    assert owner.get("/api/progress/coaching").json()["revision"] != revision
    assert owner.post(url).status_code == 409
    assert calls == [True]


def test_save_requires_messages():
    bad = _payload()
    bad["messages"] = []
    assert client.post("/api/sessions", json=bad).status_code == 422
