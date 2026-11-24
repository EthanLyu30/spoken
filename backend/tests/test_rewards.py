from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from threading import Barrier

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api import rewards
from app.db import SessionLocal
from app.main import app
from app.models.progress import LearningEvent, RewardEntry


def test_reward_claims_and_redemption_are_owner_scoped_and_repeat_safe():
    client = TestClient(app, headers={"X-Client-Id": "reward-wallet-test", "X-Timezone": "Asia/Shanghai"})
    path = "/api/practice-rewards"
    assert client.post(path + "/goal").status_code == 409
    assert client.post(path + "/wallpaper").status_code == 409
    first = client.post(path + "/checkin").json()
    assert first["checked_in"] and first["streak"] == 1 and first["coins"] == 5
    assert client.post(path + "/checkin").json() == first
    for index in range(3):
        assert client.post("/api/practice", json={"kind": "interview", "score": 0.8, "title": f"Practice {index}"}).status_code == 201
    goal = client.post(path + "/goal").json()
    assert goal["coins"] == 20 and goal["goal_claimed"]
    assert client.post(path + "/goal").json() == goal
    redeemed = client.post(path + "/wallpaper").json()
    assert redeemed["coins"] == 0 and redeemed["wallpaper_unlocked"]
    assert client.post(path + "/wallpaper").json() == redeemed
    other = client.get(path, headers={"X-Client-Id": "another-reward-owner"}).json()
    assert not other["checked_in"] and not other["wallpaper_unlocked"]


def test_checkin_streak_rollover_and_simultaneous_retries(monkeypatch):
    day = date(2026, 11, 24)
    monkeypatch.setattr(rewards, "_today", lambda: day)
    path = "/api/practice-rewards"
    with TestClient(app, headers={"X-Client-Id": "reward-streak-test"}) as client:
        with ThreadPoolExecutor(max_workers=3) as pool:
            responses = list(pool.map(lambda _: client.post(path + "/checkin"), range(3)))
        assert all(response.status_code == 200 and response.json()["coins"] == 5 for response in responses)
        yesterday = day
        day += timedelta(days=1)
        assert client.post(path + "/checkin", params={"expected_day": yesterday}).status_code == 409
        before = client.get(path).json()
        assert not before["checked_in"] and before["streak"] == 1 and before["coins"] == 5
        assert client.post(path + "/checkin", params={"expected_day": day}).json()["streak"] == 2
        day += timedelta(days=2)
        assert client.get(path).json()["streak"] == 0
        assert client.post(path + "/checkin").json()["streak"] == 1


def test_rewards_acquire_equip_and_achievements_from_saved_practice():
    owner = "reward-shop-owner"
    path = "/api/practice-rewards"
    now = rewards.utcnow()
    with SessionLocal() as db:
        db.add(RewardEntry(client_id=owner, reward_key="goal:2026-01-01", coins=160))
        for i in range(7):
            db.add(LearningEvent(client_id=owner, event_key=f"shop-learn-{i}", event_type="session",
                                 scenario_id=("cafe", "airport", "hotel", "doctor", "party")[i % 5],
                                 occurred_at=now - timedelta(days=i)))
        db.commit()
    with TestClient(app, headers={"X-Client-Id": owner}) as client:
        assert client.put(path + "/items/pip-scarf", json={"equipped": True}).status_code == 409
        for item, balance in (("pip-scarf", 140), ("cafe-chime", 110), ("cafe-rain", 30)):
            assert client.post(f"{path}/items/{item}").json()["coins"] == balance
            assert client.post(f"{path}/items/{item}").json()["coins"] == balance
            assert item in client.put(f"{path}/items/{item}", json={"equipped": True}).json()["equipment"]
        assert set(client.get(path + "/equipment").json()) == {"pip-scarf", "cafe-chime", "cafe-rain"}
        assert client.get(path + "/equipment", headers={"X-Client-Id": "reward-shop-other"}).json() == []
        assert all(badge["earned"] for badge in client.get(path).json()["achievements"])
        assert not any(badge["earned"] for badge in client.get(path, headers={"X-Client-Id": "reward-shop-other"}).json()["achievements"])


def test_weekly_challenges_count_distinct_learning_and_cannot_claim_twice(monkeypatch):
    # Beijing Sunday 23:59:59. Exercise the real timezone conversion at rollover.
    clock = datetime(2026, 11, 29, 15, 59, 59)
    monkeypatch.setattr(rewards, "utcnow", lambda: clock)
    owner = "weekly-challenge-owner"
    path = "/api/practice-rewards"
    monday = datetime(2026, 11, 22, 16)

    def record(index, kind, time, text=None):
        with SessionLocal() as db:
            db.add(LearningEvent(client_id=owner, event_key=f"weekly-challenge-{index}", event_type=kind,
                                 occurred_at=time, word_text=text))
            db.commit()

    record("sunday", "session", monday - timedelta(seconds=1))
    record("monday-1", "session", monday)
    record("monday-2", "practice", monday + timedelta(hours=5))
    record("wednesday", "session", monday + timedelta(days=2))
    for index, text in enumerate(("take a seat", " TAKE A SEAT ", "phone number", "by card", "coffee to go")):
        record(index, "word_reviewed", monday + timedelta(days=1), text)
    record("other-week", "word_reviewed", monday - timedelta(seconds=1), "past review")

    with TestClient(app, headers={"X-Client-Id": owner, "X-Timezone": "America/Los_Angeles"}) as client:
        weekly = client.get(path).json()["weekly"]
        assert weekly["starts_on"] == "2026-11-23" and weekly["ends_on"] == "2026-11-29"
        assert {g["id"]: g["count"] for g in weekly["goals"]} == {"practice-days": 2, "review-expressions": 4}
        params = {"week_start": weekly["starts_on"]}
        assert client.post(path + "/weekly/review-expressions", params=params).status_code == 409
        record("five", "word_reviewed", monday + timedelta(days=3), "invoice")
        record("third-day", "practice", monday + timedelta(days=6))
        goals = ["practice-days", "review-expressions"] * 3
        start = Barrier(len(goals), timeout=10)

        def claim(goal):
            start.wait()
            return client.post(f"{path}/weekly/{goal}", params=params)

        with ThreadPoolExecutor(max_workers=len(goals)) as pool:
            claims = list(pool.map(claim, goals))
        for goal, result in zip(goals, claims, strict=True):
            assert result.status_code == 200 and result.json()["coins"] in {15, 20, 35}
            assert next(row for row in result.json()["weekly"]["goals"] if row["id"] == goal)["claimed"]
        assert client.get(path).json()["coins"] == 35
        assert client.post(path + "/weekly/practice-days", params=params).json()["coins"] == 35
        assert client.post(path + "/weekly/review-expressions", params=params).json()["coins"] == 35
        with SessionLocal() as db:
            rows = db.execute(select(RewardEntry.reward_key, RewardEntry.coins).where(RewardEntry.client_id == owner)).all()
            assert dict(rows) == {"week:2026-11-23:practice-days": 20, "week:2026-11-23:review-expressions": 15}
        assert client.get(path, headers={"X-Client-Id": "weekly-challenge-foreign"}).json()["coins"] == 0
        clock += timedelta(seconds=1)
        for goal in set(goals):
            assert client.post(f"{path}/weekly/{goal}", params=params).status_code == 409
        fresh = client.get(path).json()
        assert fresh["weekly"]["starts_on"] == "2026-11-30" and fresh["coins"] == 35
        assert all(row["count"] == 0 and not row["claimed"] for row in fresh["weekly"]["goals"])
        record("boundary-practice", "session", clock)
        record("boundary-review", "word_reviewed", clock, "take a seat")
        at_midnight = client.get(path).json()
        assert all(row["count"] == 1 and not row["claimed"] for row in at_midnight["weekly"]["goals"])
        assert client.post(path + "/weekly/review-expressions", params={"week_start": "2026-11-30"}).status_code == 409


def test_competing_redemptions_cannot_overdraw_reward_balance():
    owner = "limited-concurrent-reward-owner"
    with SessionLocal() as db:
        db.add(RewardEntry(client_id=owner, reward_key="goal:2026-02-01", coins=30))
        db.commit()
    url = "/api/practice-rewards"
    with TestClient(app, headers={"X-Client-Id": owner}) as client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            attempts = list(pool.map(lambda item: client.post(f"{url}/items/{item}"), ["pip-scarf", "cafe-chime"]))
        assert sorted(attempt.status_code for attempt in attempts) == [200, 409]
        state = client.get(url).json()
        [owned] = [item for item in state["items"] if item["owned"]]
        assert state["coins"] == 30 - owned["price"]
        assert client.post(f"{url}/items/{owned['id']}").json()["coins"] == state["coins"]


def test_four_concurrent_redemptions_of_one_item_only_charge_once():
    owner = "same-item-concurrent-reward-owner"
    with SessionLocal() as db:
        db.add(RewardEntry(client_id=owner, reward_key="goal:2026-02-01", coins=80))
        db.commit()
    url = "/api/practice-rewards/items/cafe-rain"
    start = Barrier(4, timeout=10)
    with TestClient(app, headers={"X-Client-Id": owner}) as client:
        def redeem(_attempt):
            start.wait()
            return client.post(url)

        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(redeem, range(4)))
        assert all(response.status_code == 200 and response.json()["coins"] == 0 for response in responses)
    with SessionLocal() as db:
        charges = db.execute(select(RewardEntry.reward_key, RewardEntry.coins).where(
            RewardEntry.client_id == owner, RewardEntry.coins < 0,
        )).all()
        assert charges == [("item:cafe-rain", -80)]
