"""Service-level test for :func:`app.services.account_export.build_account_export`.

Synthetic data only: one account, a second account, and a guest device all hold
distinct rows, so the assertions prove the export is scoped to the authenticated
user rather than to a header or a global table scan. The database is an
in-memory SQLite instance, independent of the app engine.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register every table on Base.metadata)
from app.data.interview_rubric import SCORING_VERSION
from app.db import Base
from app.models.practice import PracticeRecord
from app.models.progress import EarnedBadge, GuestClaim, LearningEvent
from app.models.session import PracticeSession, SkillScore, Turn
from app.models.user import User
from app.models.word import WordEntry
from app.services.account_export import build_account_export

BASE = datetime(2026, 1, 1, 12, 0, 0)
SECRET_HASH = "pbkdf2_sha256$200000$deadbeef$cafebabe"
GUEST_DEVICE = "guest-device-abc"


@pytest.fixture()
def seeded() -> Iterator[tuple[Session, User, User]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        alice = User(
            email="alice@example.com",
            password_hash=SECRET_HASH,
            display_name="Alice",
            avatar_url="data:image/png;base64,AAAA",
            created_at=BASE,
        )
        bob = User(
            email="bob@example.com",
            password_hash=SECRET_HASH,
            display_name="Bob",
            created_at=BASE,
        )
        db.add_all([alice, bob])
        db.commit()

        _seed_owner(db, f"u:{alice.id}", "alice", base=BASE)
        _seed_owner(db, f"u:{bob.id}", "bob", base=BASE)

        # Historical interview records: one legacy 6-band row and one row under
        # the current 5-band rubric, so score_max must stay per-record.
        db.add(PracticeRecord(
            client_id=f"u:{alice.id}", kind="interview", score=4.0,
            title="alice-legacy", detail="", created_at=BASE + timedelta(hours=1),
        ))
        db.add(PracticeRecord(
            client_id=f"u:{alice.id}", kind="interview", score=5.0,
            title="alice-current",
            detail=json.dumps({"score_max": 5, "scoring_version": SCORING_VERSION}),
            created_at=BASE + timedelta(hours=2),
        ))

        # An unclaimed guest device with its own data, plus the claim row that
        # links it to Alice: neither may appear in the export.
        db.add(WordEntry(client_id=GUEST_DEVICE, text="guest-word", meaning="guest"))
        db.add(PracticeRecord(client_id=GUEST_DEVICE, kind="pronunciation",
                              score=10.0, title="guest-practice"))
        db.add(GuestClaim(client_id=GUEST_DEVICE, owner_id=f"u:{alice.id}", claimed_at=BASE))
        db.commit()

        yield db, alice, bob
    finally:
        db.close()
        engine.dispose()


def _seed_owner(db: Session, owner: str, mark: str, *, base: datetime) -> None:
    db.add(WordEntry(
        client_id=owner, text=f"{mark}-word", meaning=f"{mark} meaning",
        example=f"{mark} example", scenario_id=f"{mark}-scene", kind="word",
        box=2, due_at=base, last_reviewed=base, created_at=base,
    ))
    session = PracticeSession(
        client_id=owner, client_session_id=f"{mark}-csid", scenario_id=f"{mark}-scene",
        overall=88, summary=f"{mark} summary", tip=f"{mark} tip", created_at=base,
    )
    # Deliberately out of order: the relationship's order_by must sort these.
    session.turns = [
        Turn(idx=1, role="assistant", content=f"{mark} reply"),
        Turn(idx=0, role="user", content=f"{mark} hello"),
    ]
    session.scores = [
        SkillScore(key="fluency", label_en="Fluency", label_zh="流利度", score=80),
        SkillScore(key="grammar", label_en="Grammar", label_zh="语法", score=75),
    ]
    db.add(session)
    db.add(PracticeRecord(
        client_id=owner, kind="pronunciation", score=92.5,
        title=f"{mark}-pronunciation", detail="", created_at=base,
    ))
    db.add(LearningEvent(
        event_key=f"{mark}-event", client_id=owner, event_type="practice",
        source_id=1, client_session_id=f"{mark}-csid", occurred_at=base,
        scenario_id=f"{mark}-scene", kind="interview", score=5.0,
        word_text=f"{mark}-event",
    ))
    db.add(EarnedBadge(client_id=owner, badge_key=f"{mark}-badge", earned_at=base))
    db.commit()


def _walk_keys(value) -> Iterator[str]:
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _walk_keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_keys(item)


def _walk_values(value) -> Iterator[object]:
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_values(item)
    else:
        yield value


def test_export_contains_only_the_authenticated_account(seeded):
    db, alice, _bob = seeded

    payload = build_account_export(db, alice)

    assert payload["version"] == 1
    assert set(payload) == {
        "version", "profile", "sessions", "practice", "words",
        "learning_events", "badges",
    }
    assert payload["profile"] == {
        "email": "alice@example.com",
        "display_name": "Alice",
        "avatar_url": "data:image/png;base64,AAAA",
        "created_at": "2026-01-01T12:00:00Z",
    }

    assert [word["text"] for word in payload["words"]] == ["alice-word"]
    word = payload["words"][0]
    assert (word["box"], word["mastered"]) == (2, False)
    assert word["due_at"] == "2026-01-01T12:00:00Z"
    assert word["last_reviewed"] == "2026-01-01T12:00:00Z"

    assert len(payload["sessions"]) == 1
    session = payload["sessions"][0]
    assert session["scenario_id"] == "alice-scene"
    assert [turn["idx"] for turn in session["turns"]] == [0, 1]
    assert [turn["content"] for turn in session["turns"]] == ["alice hello", "alice reply"]
    assert [score["key"] for score in session["scores"]] == ["fluency", "grammar"]

    # pronunciation -> 100, historical interview -> 6, current rubric -> 5.
    assert [record["score_max"] for record in payload["practice"]] == [100, 6, 5]
    assert payload["practice"][1]["detail"] is None
    assert payload["practice"][2]["detail"] == {"score_max": 5, "scoring_version": SCORING_VERSION}

    assert payload["learning_events"] == [{
        "event_type": "practice",
        "occurred_at": "2026-01-01T12:00:00Z",
        "scenario_id": "alice-scene",
        "kind": "interview",
        "score": 5.0,
        "word_text": "alice-event",
    }]
    assert payload["badges"] == [{"key": "alice-badge", "earned_at": "2026-01-01T12:00:00Z"}]

    serialized = json.dumps(payload, ensure_ascii=False)
    for foreign in ("bob-word", "bob@example.com", "guest-word", "guest-device-abc",
                    "alice-csid"):
        assert foreign not in serialized
    assert "pbkdf2" not in serialized

    forbidden_keys = {
        "client_id", "client_session_id", "event_key", "source_id",
        "password_hash", "owner_id", "claimed_at", "subject_hash", "token",
    }
    assert forbidden_keys.isdisjoint(set(_walk_keys(payload)))


def test_export_is_stable_and_natively_json_encodable(seeded):
    db, alice, _bob = seeded

    first = build_account_export(db, alice)
    assert first == build_account_export(db, alice)

    # No default=str: every value must be natively JSON serialisable.
    assert json.loads(json.dumps(first)) == first
    assert not any(isinstance(value, datetime) for value in _walk_values(first))
