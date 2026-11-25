import json
from datetime import date, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.chat import get_client
from app.db import SessionLocal
from app.main import app
from app.models.progress import LearningEvent
from app.models.word import WordEntry
from app.services import progress, words

client = TestClient(app, headers={"X-Client-Id": "test-word-device"})


class _StubDefine:
    async def chat(self, messages, **_kwargs):
        return json.dumps({"meaning": "测试释义", "example": "This is a test."})


def test_add_list_master_delete():
    r = client.post(
        "/api/words",
        json={"text": "brew", "scenario_id": "cafe", "meaning": "冲泡", "example": "Let me brew coffee."},
    )
    assert r.status_code == 201
    body = r.json()
    wid = body["id"]
    assert body["text"] == "brew" and body["meaning"] == "冲泡" and body["mastered"] is False

    assert any(w["id"] == wid for w in client.get("/api/words").json())

    p = client.patch(f"/api/words/{wid}", json={"mastered": True})
    assert p.status_code == 200 and p.json()["mastered"] is True

    assert client.delete(f"/api/words/{wid}").status_code == 204
    assert not any(w["id"] == wid for w in client.get("/api/words").json())


def test_add_auto_defines_when_missing():
    app.dependency_overrides[get_client] = lambda: _StubDefine()
    try:
        r = client.post("/api/words", json={"text": "to go"})
        assert r.status_code == 201
        assert r.json()["meaning"] == "测试释义"
        assert r.json()["example"] == "This is a test."
    finally:
        app.dependency_overrides.clear()


def test_patch_missing_404():
    assert client.patch("/api/words/999999", json={"mastered": True}).status_code == 404


def test_word_topic_and_uncertain_review_keep_existing_mastery():
    owner = {"X-Client-Id": "topic-review-test"}
    word = client.post("/api/words", headers=owner, json={
        "text": "meet in the middle", "meaning": "各退一步", "example": "Let's meet in the middle.",
        "scenario_id": "negotiation", "kind": "phrase",
    }).json()
    path = f"/api/words/{word['id']}"
    assert client.patch(path, json={"topic": "报价"}).status_code == 404
    edited = client.patch(path, headers=owner, json={"topic": " 报价 "})
    assert edited.status_code == 200 and edited.json()["topic"] == "报价"
    review = {"remembered": False, "uncertain": True, "client_request_id": "uncertain-1"}
    first = client.post(path + "/review", headers=owner, json=review).json()
    second = client.post(path + "/review", headers=owner, json=review).json()
    assert first == second and first["familiarity"] == "uncertain" and first["topic"] == "报价"


def test_delete_missing_404():
    assert client.delete("/api/words/999999").status_code == 404


def test_word_source_stays_with_the_original_scene_after_topic_merge_and_retries():
    owner = {"X-Client-Id": uuid4().hex}
    scene = {"title": "Planning a handover", "title_zh": "交接会议", "partner_role": "Client",
             "goal": "确认第一天的工作安排", "persona": "Project lead", "opening_line": "When can you start?"}
    item = {"text": "We could begin within a week of signing.", "meaning": "我们可以在签署后一周内开始。",
            "example": "We could begin within a week of signing.", "kind": "sentence", "scenario_id": "custom",
            "topic": "旧话题", "custom_scene": scene, "previous_partner_message": "How soon can you start?"}
    one = client.post("/api/words", headers=owner, json=item).json()
    other_scene = {**scene, "goal": "确认钥匙的交接地点"}
    two = client.post("/api/words", headers=owner, json={**item, "text": "Let's meet at the front desk.",
                      "custom_scene": other_scene, "previous_partner_message": "Where should we meet?"}).json()
    assert one["source"]["title"] == two["source"]["title"] == "交接会议"
    assert one["source"]["key"] != two["source"]["key"]
    assert one["source"]["previous_partner_message"] == "How soon can you start?"
    repeated = client.post("/api/words", headers=owner, json={**item, "custom_scene": other_scene}).json()
    assert repeated["id"] == one["id"] and repeated["source"] == one["source"]
    assert client.patch("/api/words/topics", headers=owner, json={"source": "旧话题", "target": "新话题"}).is_success
    updated = {row["id"]: row for row in client.get("/api/words", headers=owner).json()}
    assert len(updated) == 2
    for row in (one, two):
        assert updated[row["id"]]["topic"] == "新话题"
        assert updated[row["id"]]["source"] == row["source"]
    assert client.get("/api/words", headers={"X-Client-Id": uuid4().hex}).json() == []


def test_rename_topic_moves_all_kinds_including_builtin_default_for_owner_only():
    for owner in ("topic-rename-alice", "topic-rename-bob"):
        for text, kind in (("quote", "word"), ("Can we lower the price?", "sentence")):
            assert client.post("/api/words", headers={"X-Client-Id": owner}, json={
                "text": text, "kind": kind, "meaning": "报价", "example": "Can we lower the price?",
                "scenario_id": "negotiation",
            }).status_code == 201
    headers = {"X-Client-Id": "topic-rename-alice"}
    body = {"source": "商务谈判", "target": "谈价格"}
    result = client.patch("/api/words/topics", headers=headers, json=body)
    assert result.status_code == 200
    assert {row["kind"] for row in result.json()} == {"word", "sentence"}
    assert {row["topic"] for row in client.get("/api/words", headers=headers).json()} == {"谈价格"}
    assert {row["topic"] for row in client.get("/api/words", headers={"X-Client-Id": "topic-rename-bob"}).json()} == {None}
    assert client.patch("/api/words/topics", headers=headers, json=body).json() == []


def test_topic_merge_uses_bearer_owner_even_with_another_devices_header():
    guest = f"topic-foreign-{uuid4().hex}"
    signed_in = []
    for _ in range(2):
        reply = client.post("/api/auth/register", headers={"X-Client-Id": uuid4().hex}, json={
            "email": f"{uuid4().hex}@example.test", "password": "whole-topic-owner-test",
        })
        assert reply.status_code == 201
        signed_in.append({"Authorization": f"Bearer {reply.json()['token']}", "X-Client-Id": guest})
    for headers in (*signed_in, {"X-Client-Id": guest}):
        assert client.post("/api/words", headers=headers, json={
            "text": "Delivery window", "meaning": "交付时间段", "example": "Can we change the delivery window?", "topic": "时间",
        }).status_code == 201
    assert client.patch("/api/words/topics", headers=signed_in[0], json={"source": "时间", "target": "订单"}).json()[0]["topic"] == "订单"
    assert [row["topic"] for row in client.get("/api/words", headers=signed_in[1]).json()] == ["时间"]
    assert [row["topic"] for row in client.get("/api/words", headers={"X-Client-Id": guest}).json()] == ["时间"]
    bad = {"Authorization": "Bearer invalid", "X-Client-Id": guest}
    assert client.patch("/api/words/topics", headers=bad, json={"source": "时间", "target": "错账号"}).status_code == 401


@pytest.mark.parametrize("protocol", ["0", "1"])
def test_late_guest_group_edit_cannot_rename_account_words_after_registration(monkeypatch, protocol):
    monkeypatch.setenv("GUEST_CLAIM_PROTOCOL", protocol)
    guest = {"X-Client-Id": uuid4().hex}
    word = {"text": "Original expression", "meaning": "表达", "example": "An example.", "topic": "旧话题"}
    assert client.post("/api/words", headers=guest, json=word).status_code == 201
    registration = guest
    if protocol == "1":
        transition = {**guest, "X-Claim-Transition": uuid4().hex}
        ticket = client.get("/api/auth/guest-capabilities", headers=transition).json()["ticket"]
        registration = {**transition, "X-Claim-Protocol": "1", "X-Claim-Ticket": ticket}
    account = client.post("/api/auth/register", headers=registration, json={
        "email": f"{uuid4().hex}@example.test", "password": "topic-late-edit-test",
    })
    assert account.status_code == 201
    auth = {**guest, "Authorization": f"Bearer {account.json()['token']}"}
    assert client.post("/api/words", headers=guest, json={**word, "text": "Guest only expression"}).status_code == 201
    late = client.patch("/api/words/topics", headers={**guest, "X-Claim-Protocol": "1"}, json={
        "source": "旧话题", "target": "迟到的改名",
    })
    assert late.status_code == (409 if protocol == "1" else 200)
    if protocol == "1":
        assert late.json()["detail"] == "guest_data_claimed"
    assert [(row["text"], row["topic"]) for row in client.get("/api/words", headers=auth).json()] == [
        ("Original expression", "旧话题"),
    ]
    [guest_row] = client.get("/api/words", headers=guest).json()
    assert guest_row["text"] == "Guest only expression"
    assert guest_row["topic"] == ("旧话题" if protocol == "1" else "迟到的改名")


def test_translation_only_sends_owned_prompt_and_accepts_paraphrases(monkeypatch):
    calls = []

    class Judge:
        async def chat(self, messages, **_kwargs):
            calls.append(json.loads(messages[-1]["content"]))
            return json.dumps({"verdict": "equivalent", "feedback": "保留了调整交期才能调整价格的条件。"})

    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: Judge())
    headers = {"X-Client-Id": "translation-grade-owner"}
    word = client.post("/api/words", headers=headers, json={
        "text": "We can adjust the price if we change the timeline.", "meaning": "如果调整时间安排，我们可以改价格。",
        "example": "We can adjust the price if we change the timeline.", "kind": "sentence",
    }).json()
    path = f"/api/words/{word['id']}/translation"
    answer = {"answer": "If we revise the schedule, we can change the price."}
    assert client.post(path, json=answer).status_code == 404
    assert not calls
    result = client.post(path, headers=headers, json=answer)
    assert result.status_code == 200 and result.json()["verdict"] == "equivalent"
    assert calls[0]["meaning"] == word["meaning"] and calls[0]["reference"] == word["text"]

    question = "You are coming?"
    question_word = client.post("/api/words", headers=headers, json={
        "text": question, "meaning": "你会来吗？", "example": question, "kind": "sentence",
    }).json()
    exact = client.post(f"/api/words/{question_word['id']}/translation", headers=headers, json={"answer": "You are coming？"})
    assert exact.status_code == 200 and exact.json()["verdict"] == "equivalent"
    assert len(calls) == 1


@pytest.mark.parametrize(("meaning", "reference", "answer"), [
    ("如果我们调整交期，就可以调整价格。", "We can adjust the price if we change the delivery date.",
     "We can adjust the price due to changing the delivery date."),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "The match will be cancelled because it rains."),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "Because it rains, the match will be cancelled."),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "The match will be cancelled due to rain."),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "Owing to rain, the match will be cancelled."),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "The match will be cancelled as a result of rain."),
])
def test_translation_rejects_clear_replacement_of_condition_with_cause(monkeypatch, meaning, reference, answer):
    class Judge:
        async def chat(self, _messages, **_kwargs):
            pytest.fail("A clear condition-to-cause substitution should not reach the model")

    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: Judge())
    headers = {"X-Client-Id": uuid4().hex}
    saved = client.post("/api/words", headers=headers, json={
        "text": reference, "meaning": meaning, "example": reference, "kind": "sentence",
    })
    assert saved.status_code == 201
    result = client.post(f"/api/words/{saved.json()['id']}/translation", headers=headers, json={"answer": answer})
    assert result.status_code == 200 and result.json()["verdict"] == "different"
    assert "条件" in result.json()["feedback"] and "原因" in result.json()["feedback"]


@pytest.mark.parametrize(("meaning", "reference", "answer", "verdict"), [
    ("如果改交期，就能调价。", "We can adjust the price if we change the delivery date.",
     "We could change the price as long as we reschedule delivery.", "equivalent"),
    ("只要体育场没有因为下雨而关闭，比赛就继续。", "As long as the stadium doesn't close because of rain, the match continues.",
     "The match will go ahead provided the stadium doesn't shut due to rain.", "equivalent"),
    ("比赛因为下雨被取消了。", "The match was cancelled because of rain.",
     "Owing to rain, the match was called off.", "equivalent"),
    ("从我们改了交期以来，价格一直没变。", "The price has stayed the same since we changed the delivery date.",
     "Since we moved the delivery date, the price hasn't changed.", "equivalent"),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "Since it rains, the match will be cancelled.", "different"),
    ("如果下雨，比赛就取消。", "If it rains, the match will be cancelled.",
     "In the event of rain, the match will be called off.", "equivalent"),
    ("如果下一场比赛取消，本场比赛安排在明天开赛。", "If the next match is called off, this one is due to start tomorrow.",
     "This match is due to start tomorrow, subject to the next match being cancelled.", "equivalent"),
    ("如果修改交货日期，我们就可以给你更低的价格。", "If we move the delivery date, we can offer you a lower price.",
     "Move the delivery date and we can offer a lower price because our costs will fall.", "equivalent"),
])
def test_translation_keeps_conditions_causes_and_temporal_since_in_semantic_grading(monkeypatch, meaning, reference, answer, verdict):
    calls = []

    class Judge:
        async def chat(self, messages, **_kwargs):
            calls.append(json.loads(messages[-1]["content"]))
            return json.dumps({"verdict": verdict, "feedback": "对照原意。"})

    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: Judge())
    headers = {"X-Client-Id": uuid4().hex}
    saved = client.post("/api/words", headers=headers, json={"text": reference, "meaning": meaning, "example": reference})
    assert saved.status_code == 201
    result = client.post(f"/api/words/{saved.json()['id']}/translation", headers=headers, json={"answer": answer})
    assert result.status_code == 200 and result.json()["verdict"] == verdict
    assert calls == [{"meaning": meaning, "reference": reference, "answer": answer}]


@pytest.mark.parametrize(("answer", "checks", "expected"), [
    ("We could change the price as long as we reschedule delivery.", (True, True, True), "equivalent"),
    ("We can move the delivery date if we change the price.", (False, False, True), "different"),
    ("Even if we move the delivery date, we can't change the price.", (True, False, True), "different"),
])
def test_rechecks_rejected_conditionals_without_waiving_meaning_changes(monkeypatch, answer, checks, expected):
    calls = []

    class Judge:
        async def chat(self, messages, **_kwargs):
            calls.append(json.loads(messages[-1]["content"]))
            if len(calls) == 1:
                return json.dumps({"verdict": "different", "feedback": "条件或结果可能不同。"})
            condition, outcome, details = checks
            return json.dumps({"same_condition": condition, "same_outcome": outcome, "same_other_details": details})

    monkeypatch.setitem(app.dependency_overrides, get_client, lambda: Judge())
    headers = {"X-Client-Id": uuid4().hex}
    reference = "We can adjust the price if we change the delivery date."
    saved = client.post("/api/words", headers=headers, json={
        "text": reference, "meaning": "如果我们调整交期，就可以调整价格。", "example": reference, "kind": "sentence",
    })
    assert saved.status_code == 201
    result = client.post(f"/api/words/{saved.json()['id']}/translation", headers=headers, json={"answer": answer})
    assert result.status_code == 200 and result.json()["verdict"] == expected
    assert len(calls) == 2 and calls[0] == calls[1]


def test_srs_review_updates_box_and_due():
    r = client.post(
        "/api/words",
        json={"text": "srs-demo-word", "meaning": "m", "example": "e", "kind": "word"},
    )
    wid = r.json()["id"]
    assert r.json()["box"] == 0  # new word starts in box 0

    # A saved expression joins scheduled review only after its first rating.
    due = client.get("/api/words/due?kind=word").json()
    assert not any(w["id"] == wid for w in due)

    # Remembering it bumps the box and pushes the due date out (no longer due).
    rv = client.post(f"/api/words/{wid}/review", json={"remembered": True})
    assert rv.status_code == 200 and rv.json()["box"] == 1
    assert not any(w["id"] == wid for w in client.get("/api/words/due?kind=word").json())

    # Forgetting resets it to box 0 and makes it due again.
    rv2 = client.post(f"/api/words/{wid}/review", json={"remembered": False})
    assert rv2.json()["box"] == 0
    assert any(w["id"] == wid for w in client.get("/api/words/due?kind=word").json())

    client.delete(f"/api/words/{wid}")


@pytest.mark.parametrize(("choice", "familiarity", "box", "interval"), [
    ({"remembered": True}, "familiar", 1, timedelta(days=1)),
    ({"remembered": False, "uncertain": True}, "uncertain", 0, timedelta(hours=12)),
    ({"remembered": False}, "forgot", 0, timedelta()),
])
def test_recall_after_forgetting_has_one_progress_item_and_preserves_saved_due_date(choice, familiarity, box, interval):
    owner = f"srs-in-session-recall-{familiarity}"
    headers = {"X-Client-Id": owner}
    word = client.post("/api/words", headers=headers, json={
        "text": "I can look into it.", "meaning": "我可以调查这件事。", "example": "I can look into it.",
    }).json()
    path = f"/api/words/{word['id']}/review"
    first = {"remembered": False, "client_request_id": "first"}
    repeat = {**choice, "client_request_id": "repeat"}
    forgotten = client.post(path, headers=headers, json=first).json()
    assert forgotten["box"] == 0 and forgotten["last_reviewed"] == forgotten["due_at"]
    latest = client.post(path, headers=headers, json=repeat).json()
    assert latest["box"] == box and latest["familiarity"] == familiarity
    assert datetime.fromisoformat(latest["due_at"]) - datetime.fromisoformat(latest["last_reviewed"]) == interval
    assert client.post(path, headers=headers, json=repeat).json() == latest
    assert client.post(path, headers=headers, json=first).json() == latest
    assert client.get("/api/words", headers=headers).json()[0]["due_at"] == latest["due_at"]
    with SessionLocal() as db:
        rows = db.scalars(select(LearningEvent).where(LearningEvent.client_id == owner, LearningEvent.event_type == "word_reviewed")).all()
        assert len(rows) == 2  # Two spaced-repetition decisions, one distinct expression for progress.
        assert progress._sql_activity(db, owner, "Asia/Shanghai", date.today()).reviewed == 1


def test_review_missing_404():
    assert client.post("/api/words/999999/review", json={"remembered": True}).status_code == 404


def test_stale_word_rating_cannot_attach_to_a_reused_id():
    owner = uuid4().hex
    headers = {"X-Client-Id": owner}
    item = {"text": "in another lifetime", "meaning": "在另一个时间", "example": "In another lifetime."}
    original = client.post("/api/words", headers=headers, json=item).json()
    path = f"/api/words/{original['id']}"
    assert client.delete(path, headers=headers).status_code == 204
    # Force id recycling on both SQLite and Postgres, and keep the same text.
    with SessionLocal() as db:
        replacement_time = datetime.fromisoformat(original["created_at"]) + timedelta(microseconds=1)
        replacement = WordEntry(id=original["id"], client_id=owner, created_at=replacement_time, **item)
        words.record_collection(db, replacement)
        db.commit()

    before, = client.get("/api/words", headers=headers).json()
    body = {"remembered": True, "client_request_id": "first-delivery-old-card"}
    assert client.post(path + "/review", headers=headers, json={**body, "created_at": original["created_at"]}).status_code == 409
    assert client.post(path + "/review", headers=headers, json=body).status_code == 409
    assert client.get("/api/words", headers=headers).json() == [before]
    with SessionLocal() as db:
        assert db.scalar(select(LearningEvent).where(LearningEvent.client_id == owner, LearningEvent.event_type == "word_reviewed")) is None

    fresh = {**body, "created_at": before["created_at"]}
    applied = client.post(path + "/review", headers=headers, json=fresh)
    assert applied.status_code == 200 and applied.json()["box"] == 1
    assert client.post(path + "/review", headers=headers, json=fresh).json() == applied.json()
    with SessionLocal() as db:
        assert len(db.scalars(select(LearningEvent).where(LearningEvent.client_id == owner, LearningEvent.event_type == "word_reviewed")).all()) == 1


def test_add_is_idempotent_and_stores_kind():
    payload = {
        "text": "a unique sentence here",
        "meaning": "x",
        "example": "y",
        "kind": "sentence",
    }
    a = client.post("/api/words", json=payload)
    b = client.post("/api/words", json=payload)
    assert a.status_code == 201 and b.status_code == 201
    assert a.json()["id"] == b.json()["id"]  # no duplicate row
    assert a.json()["kind"] == "sentence"


def test_word_definition_happens_before_guest_write_lock(monkeypatch):
    from app.services import words as repo

    calls = []

    async def fake_define(text, deepseek):
        calls.append("define")
        return "延迟释义", "This definition came from an external call."

    real_lock = repo.progress.lock_owner

    def recording_lock(db, owner):
        calls.append("lock")
        return real_lock(db, owner)

    monkeypatch.setattr(repo, "define_word", fake_define)
    monkeypatch.setattr(repo.progress, "lock_owner", recording_lock)

    response = client.post(
        "/api/words",
        json={"text": "definition-before-lock", "scenario_id": "cafe"},
    )

    assert response.status_code == 201
    assert calls[:2] == ["define", "lock"]
