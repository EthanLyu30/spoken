from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models.scene_cues import ScenePreparation


URL = "/api/scene-cues/cafe"
LATTE = {"id": "default-1", "kind": "word", "keyword": "latte", "meaning": "拿铁", "sentence": "A latte, please."}
CARD = {"id": "default-2", "kind": "phrase", "keyword": "by card", "meaning": "刷卡", "sentence": "Can I pay by card?"}
DEFAULTS = [LATTE, CARD]
FRESH = {"revision": 0, "cues": None}
ROOM = {
    "title": "Booking", "title_zh": "订房", "partner_role": "hotel clerk", "goal": "Book a room.",
    "persona": "You work at a busy hotel.", "opening_line": "Which dates would you like?",
}
EXERCISES = [
    {"partner_line": "Which dates?", "task": "说出日期", "hint": "提到星期几", "example": "From Friday."},
    {"partner_line": "Will you need breakfast?", "task": "询问早餐", "hint": "确认价格", "example": "Is it included?"},
]


def guest():
    return {"X-Client-Id": uuid4().hex}


def patch(client, headers, action, *, url=URL, **fields):
    return client.patch(url, headers=headers, json={"defaults": DEFAULTS, "action": action, **fields})


def test_edits_replace_defaults_and_an_empty_personal_list_survives_new_visits():
    owner = guest()
    with TestClient(app) as client:
        assert client.get(URL, headers=owner).json() == FRESH
        draft = {**LATTE, "keyword": "decaf", "sentence": "Can I get a decaf?"}
        edited = patch(client, owner, "save", cue=draft)
        assert edited.status_code == 200
        assert edited.json()["cues"] == [draft, CARD]
        assert patch(client, owner, "remove", id=CARD["id"]).json()["cues"] == [draft]
        assert patch(client, owner, "remove", id=LATTE["id"]).json()["cues"] == []
        empty = client.get(URL, headers=owner)
        assert empty.json() == {"revision": 3, "cues": []}
        assert "no-store" in empty.headers["cache-control"]
        assert client.get("/api/scene-cues/airport", headers=owner).json() == FRESH
        assert client.get(URL, headers=guest()).json() == FRESH
        # Repeating a removal after losing its response leaves the same version intact.
        assert patch(client, owner, "remove", id=LATTE["id"]).json() == empty.json()
        assert patch(client, owner, "save", cue=draft).status_code == 409


def test_parallel_devices_keep_distinct_edits_and_deduplicate_new_entries_and_hints():
    owner = guest()
    with TestClient(app) as client:
        word = {"kind": "word", "keyword": "receipt", "meaning": "", "sentence": "Receipt, please."}
        actions = [
            ("save", {"cue": {**CARD, "sentence": "I'll use my card."}}),
            ("save", {"cue": word}), ("save", {"cue": word}),
            ("add_hint", {"sentence": "Could I have it iced?"}),
            ("add_hint", {"sentence": "  COULD  I have it iced?  "}),
            ("add_hint", {"sentence": "A latte, please."}),
        ]
        with ThreadPoolExecutor(max_workers=len(actions)) as pool:
            responses = list(pool.map(lambda action: patch(client, owner, action[0], **action[1]), actions))
        assert all(response.status_code == 200 for response in responses)
        items = client.get(URL, headers=owner).json()["cues"]
        assert len(items) == 4
        assert items[:2] == [LATTE, {**CARD, "sentence": "I'll use my card."}]
        assert sum(item["keyword"] == "receipt" for item in items) == 1
        assert any(item["kind"] == "pattern" and "iced?" in item["sentence"] for item in items)
        assert len({item["id"] for item in items}) == len(items)


def test_custom_scene_contents_distinguish_lessons_and_round_trip_with_optional_display_fields():
    owner = guest()
    lookup = "/api/scene-cues/custom/lookup"
    with TestClient(app) as client:
        lesson = {**ROOM, "practice_exercises": EXERCISES}
        hint = patch(client, owner, "add_hint", url="/api/scene-cues/custom", custom=lesson, sentence="I will arrive Friday.")
        assert hint.status_code == 200
        # Reading a saved lesson adds defaulted nulls and a display-only source.
        restored = {**lesson, "source": "我的练习", "practice_cues": [],
                    "practice_exercises": [{**item, "target": None} for item in EXERCISES]}
        assert client.post(lookup, headers=owner, json={"custom": restored}).json() == hint.json()
        for other_scene in (ROOM, {**ROOM, "persona": "You rent small boats."},
                            {**lesson, "practice_exercises": [EXERCISES[0], {**EXERCISES[1], "example": "How much?"}]}):
            assert client.post(lookup, headers=owner, json={"custom": other_scene}).json() == FRESH
        assert client.get("/api/scene-cues/custom", headers=owner).status_code == 422


def test_sign_up_claim_account_devices_export_and_deletion_keep_owner_boundaries(monkeypatch):
    monkeypatch.setenv("GUEST_CLAIM_PROTOCOL", "1")
    owner = guest()
    credentials = {"email": f"{uuid4().hex}@example.test", "password": "scene-cues-test-password"}
    with TestClient(app) as client:
        seeded = patch(client, owner, "remove", id=LATTE["id"])
        assert seeded.status_code == 200
        transition = {**owner, "X-Claim-Transition": uuid4().hex}
        ticket = client.get("/api/auth/guest-capabilities", headers=transition).json()["ticket"]
        registered = client.post("/api/auth/register", headers={
            **transition, "X-Claim-Protocol": "1", "X-Claim-Ticket": ticket,
        }, json=credentials)
        assert registered.status_code == 201
        account = {**guest(), "Authorization": "Bearer " + registered.json()["token"]}
        assert client.get(URL, headers=account).json() == seeded.json()
        assert client.get(URL, headers=owner).json() == FRESH
        late = patch(client, {**owner, "X-Claim-Protocol": "1"}, "add_hint", sentence="Wrong owner.")
        assert late.status_code == 409 and late.json()["detail"] == "guest_data_claimed"
        assert patch(client, owner, "add_hint", sentence="Only on this device.").status_code == 200
        assert client.get(URL, headers={**owner, "Authorization": account["Authorization"]}).json() == seeded.json()
        exported = client.get("/api/auth/me/export", headers=account).json()["scene_cues"]
        assert len(exported) == 1 and exported[0]["scene_key"] == "cafe"
        assert exported[0]["cues"] == [CARD]
        assert client.get(URL, headers={"X-Client-Id": "u:1"}).status_code == 400
        assert client.get(URL, headers={"Authorization": "Bearer expired", **owner}).status_code == 401
        assert client.request("DELETE", "/api/auth/me", headers=account, json={"password": credentials["password"]}).status_code == 204
        with SessionLocal() as db:
            owner_id = registered.json()["user"]["id"]
            assert db.get(ScenePreparation, (f"u:{owner_id}", "cafe")) is None
        assert client.get(URL, headers=account).status_code == 401
        # SQLite can reuse an erased user's numeric id on the next registration.
        replacement = client.post("/api/auth/register", json=credentials).json()["token"]
        assert client.get(URL, headers={"Authorization": "Bearer " + replacement}).json() == FRESH
        assert len(client.get(URL, headers=owner).json()["cues"]) == 3
