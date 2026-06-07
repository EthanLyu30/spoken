from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_save_and_list_practice():
    resp = client.post(
        "/api/practice",
        json={"kind": "pronunciation", "score": 88.5, "title": "Stay hungry."},
    )
    assert resp.status_code == 201
    rec = resp.json()
    assert rec["kind"] == "pronunciation"
    assert rec["score"] == 88.5
    assert rec["id"] > 0

    listed = client.get("/api/practice?kind=pronunciation").json()
    assert any(r["id"] == rec["id"] for r in listed)


def test_practice_kind_filter():
    client.post("/api/practice", json={"kind": "interview", "score": 5, "title": "限时问答"})
    only = client.get("/api/practice?kind=interview").json()
    assert only and all(r["kind"] == "interview" for r in only)


def test_prune_records_keeps_only_newest():
    from app.db import SessionLocal
    from app.services import practice as repo

    for _ in range(4):
        client.post("/api/practice", json={"kind": "pronunciation", "score": 60})
    db = SessionLocal()
    try:
        repo.prune_records(db, keep=3)
    finally:
        db.close()
    # Pruning retains exactly the newest `keep` records across the whole table.
    assert len(client.get("/api/practice?limit=1000").json()) == 3


def test_stats_shape_and_activity():
    client.post("/api/practice", json={"kind": "pronunciation", "score": 70})
    s = client.get("/api/stats").json()
    # shape
    for key in (
        "streak_days",
        "today_count",
        "today_goal",
        "level",
        "xp",
        "xp_to_next",
        "total_sessions",
        "total_practice",
        "words_count",
    ):
        assert key in s
    # saving practice today implies activity today and a live streak
    assert s["total_practice"] >= 1
    assert s["today_count"] >= 1
    assert s["streak_days"] >= 1
    assert s["level"] >= 1
    assert s["today_goal"] == 3
