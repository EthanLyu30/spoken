"""Cross-session ability insights (/api/stats/insights)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _skill(key: str, label_zh: str, score: int) -> dict:
    return {"key": key, "label_en": key, "label_zh": label_zh, "score": score}


def _save_session(scores: list[dict], cid: str, overall: int = 70) -> None:
    resp = client.post(
        "/api/sessions",
        headers={"X-Client-Id": cid},
        json={
            "scenario_id": "cafe",
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
            "overall": overall,
            "summary": "",
            "tip": "",
            "scores": scores,
        },
    )
    assert resp.status_code in (200, 201), resp.text


def test_insights_unavailable_without_sessions():
    r = client.get("/api/stats/insights", headers={"X-Client-Id": "insights-empty"}).json()
    assert r["available"] is False
    assert r["sessions"] == 0
    assert r["skills"] == []
    assert r["weakest"] is None and r["strongest"] is None


def test_insights_finds_weakest_and_climbing_trend():
    cid = "insights-trend"
    # Oldest -> newest. Grammar is consistently the weakest dimension but is
    # climbing; vocabulary stays strong and flat.
    _save_session([_skill("grammar", "语法", 50), _skill("vocabulary", "词汇", 90)], cid)
    _save_session([_skill("grammar", "语法", 58), _skill("vocabulary", "词汇", 88)], cid)
    _save_session([_skill("grammar", "语法", 80), _skill("vocabulary", "词汇", 92)], cid)
    _save_session([_skill("grammar", "语法", 86), _skill("vocabulary", "词汇", 90)], cid)

    r = client.get("/api/stats/insights", headers={"X-Client-Id": cid}).json()
    assert r["available"] is True
    assert r["sessions"] == 4
    # Weakest dimension to focus on is grammar; strongest is vocabulary.
    assert r["weakest"]["key"] == "grammar"
    assert r["strongest"]["key"] == "vocabulary"
    # Skills are returned weakest-first.
    assert r["skills"][0]["key"] == "grammar"
    # Grammar's later half (80, 86) beats its earlier half (50, 58) -> climbing.
    grammar = next(s for s in r["skills"] if s["key"] == "grammar")
    assert grammar["delta"] > 0
    assert grammar["samples"] == 4
    # Overall direction of travel is positive.
    assert r["overall_delta"] > 0


def test_insights_only_counts_recent_window():
    cid = "insights-window"
    # Save more than INSIGHTS_RECENT (8) sessions; only the latest 8 should count.
    for i in range(10):
        _save_session([_skill("fluency", "流利度", 60 + i)], cid)
    r = client.get("/api/stats/insights", headers={"X-Client-Id": cid}).json()
    assert r["available"] is True
    assert r["sessions"] == 8
