from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.db import SessionLocal, engine
from app.main import app
from app.models.progress import LearningEvent
from app.models.word import WordEntry


def test_retest_freezes_both_tabs_persists_each_rating_once_and_skips_deleted_items():
    owner = uuid4().hex
    client = TestClient(app, headers={"X-Client-Id": owner})
    stranger = TestClient(app, headers={"X-Client-Id": uuid4().hex})

    def collect(text, kind="word"):
        saved = client.post("/api/words", json={"text": text, "meaning": "释义", "example": text, "kind": kind})
        assert saved.status_code == 201
        return saved.json()

    term = collect("quotation")
    sentence = collect("I can offer a lower price.", "sentence")
    with SessionLocal() as db:
        learned = db.get(WordEntry, term["id"])
        learned.mastered = True
        learned.familiarity = "familiar"
        learned.due_at += timedelta(days=12)
        db.commit()
    assert client.patch("/api/scene-cues/negotiation", json={"action": "add_hint", "defaults": [],
        "sentence": "We can reschedule delivery.", "meaning": "我们可以调整交期。"}).is_success
    path = "/api/words/retest"
    preview = client.get(path).json()
    assert (preview["words"], preview["sentences"], preview["unadded_scene"], preview["round"]) == (1, 1, 1, None)
    started = client.post(path, json={"include_scene": True}).json()
    assert (started["words"], started["sentences"], started["next_item"]["word"]["id"]) == (1, 2, term["id"])
    assert client.post(path, json={"include_scene": False}).json() == started
    assert client.get(path).json()["round"] == started

    rate = f"{path}/{started['id']}/items/{started['next_item']['position']}"
    assert stranger.patch(rate, json={"rating": "forgot"}).status_code == 404
    with ThreadPoolExecutor(max_workers=3) as workers:
        responses = list(workers.map(lambda _: client.patch(rate, json={"rating": "forgot"}), range(3)))
    assert [item.status_code for item in responses] == [200] * 3
    assert all(item.json()["forgot"] == 1 for item in responses)
    assert client.patch(rate, json={"rating": "familiar"}).status_code == 409

    assert client.delete(f"/api/words/{sentence['id']}").status_code == 204
    extra = collect("This came in after the round began.", "sentence")
    resumed = client.get(path).json()["round"]
    assert resumed["skipped"] == 1 and resumed["forgot"] == 1
    item = resumed["next_item"]
    assert item["word"]["text"] == "We can reschedule delivery."
    assert item["word"]["scenario_id"] == "negotiation"
    end = client.patch(f"{path}/{resumed['id']}/items/{item['position']}", json={"rating": "uncertain"}).json()
    assert end["next_item"] is None and end["uncertain"] == 1 and end["forgot"] == 1
    assert client.get(path).json()["round"] == end
    with SessionLocal() as db:
        assert db.get(WordEntry, extra["id"]).last_reviewed is None
        assert db.get(WordEntry, term["id"]).mastered is False
        assert db.scalar(select(WordEntry).where(WordEntry.id == term["id"])).familiarity == "forgot"
        events = db.scalars(select(LearningEvent).where(LearningEvent.client_id == owner,
            LearningEvent.event_type == "word_reviewed")).all()
        assert len(events) == 2
    next_run = client.post(path, json={"replace_id": end["id"]}).json()
    assert next_run["id"] != end["id"] and next_run["sentences"] == 2
    assert client.post(path, json={"replace_id": end["id"]}).json() == next_run


def test_retest_preserves_same_text_rows_and_is_claimed_with_the_guest_word_bag():
    device = uuid4().hex
    headers = {"X-Client-Id": device}
    client = TestClient(app, headers=headers)
    with SessionLocal() as db:
        for scene in ("airport", "hotel"):
            db.add(WordEntry(client_id=device, text="Could you help me?", meaning="你能帮我吗？",
                             kind="sentence", scenario_id=scene))
        db.commit()
    route = "/api/words/retest"
    round_state = client.post(route, json={}).json()
    first = round_state["next_item"]
    assert round_state["sentences"] == 2
    rating_url = f"{route}/{round_state['id']}/items/{first['position']}"
    after = client.patch(rating_url, json={"rating": "familiar"}).json()
    assert after["familiar"] == 1
    assert after["next_item"]["word"]["text"] == first["word"]["text"]
    assert after["next_item"]["word"]["scenario_id"] != first["word"]["scenario_id"]

    account = client.post("/api/auth/register", json={"email": f"{device}@example.test", "password": "retest-login-password"})
    assert account.status_code == 201
    authenticated = {"Authorization": f"Bearer {account.json()['token']}"}
    assert client.get(route, headers=authenticated).json()["round"] == after
    assert client.get(route).json()["round"] is None
    assert client.patch(rating_url, json={"rating": "familiar"}).status_code == 404


def test_duplicate_ordinary_receipts_from_other_tabs_cannot_overwrite_a_newer_retest():
    owner = uuid4().hex
    client = TestClient(app, headers={"X-Client-Id": owner})
    other_tab = TestClient(app, headers={"X-Client-Id": owner})
    created = client.post("/api/words", json={"text": "itinerary", "meaning": "行程", "example": "Check the itinerary."})
    assert created.status_code == 201
    word = created.json()
    started = client.post("/api/words/retest", json={}).json()
    ordinary_url = f"/api/words/{word['id']}/review"
    receipt = {"remembered": True, "created_at": word["created_at"], "client_request_id": "same-older-choice"}
    ordinary = client.post(ordinary_url, json=receipt)
    assert ordinary.status_code == 200 and ordinary.json()["box"] == 1

    position = started["next_item"]["position"]
    result = client.patch(f"/api/words/retest/{started['id']}/items/{position}", json={"rating": "forgot"})
    assert result.status_code == 200 and result.json()["forgot"] == 1
    latest, = client.get("/api/words").json()
    assert latest["familiarity"] == "forgot" and latest["box"] == 0

    replay = other_tab.post(ordinary_url, json=receipt)
    assert replay.status_code == 200 and replay.json() == latest
    assert client.get("/api/words").json() == [latest]
    with SessionLocal() as db:
        events = db.scalars(select(LearningEvent).where(LearningEvent.client_id == owner,
            LearningEvent.event_type == "word_reviewed")).all()
        assert len(events) == 2


@pytest.mark.skipif(engine.dialect.name != "postgresql", reason="requires PostgreSQL read-committed snapshots")
def test_retest_read_keeps_counts_and_next_item_together_during_final_rating():
    client = TestClient(app, headers={"X-Client-Id": uuid4().hex})
    assert client.post("/api/words", json={"text": "quotation", "meaning": "报价", "example": "Send a quotation."}).is_success
    path = "/api/words/retest"
    started = client.post(path, json={}).json()
    rating_path = f"{path}/{started['id']}/items/{started['next_item']['position']}"
    entered = False
    committed = None

    def grade_after_round_query(_conn, _cursor, sql, *_args):
        nonlocal entered, committed
        if entered or "from word_retest_items" not in sql.lower():
            return
        # At this point the read has already taken its statement snapshot.
        # Run the final rating in another request and transaction.
        entered = True
        committed = client.patch(rating_path, json={"rating": "familiar"})

    event.listen(engine, "after_cursor_execute", grade_after_round_query)
    try:
        concurrent = client.get(path).json()["round"]
    finally:
        event.remove(engine, "after_cursor_execute", grade_after_round_query)

    assert committed is not None and committed.status_code == 200
    assert concurrent == started
    final = client.get(path).json()["round"]
    assert final["familiar"] == 1 and final["next_item"] is None
