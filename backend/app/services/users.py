"""Account persistence + claiming anonymous device data on sign-up."""

from __future__ import annotations

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.practice import PracticeRecord
from app.models.session import PracticeSession
from app.models.user import User
from app.models.word import WordEntry

# Every owner-scoped table keyed by client_id; claiming rewrites the owner.
_OWNED = (WordEntry, PracticeSession, PracticeRecord)


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email)).first()


def create_user(db: Session, email: str, password_hash: str, display_name: str = "") -> User:
    user = User(email=email, password_hash=password_hash, display_name=display_name)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def claim_device_data(db: Session, device_id: str, owner_id: str) -> None:
    """Move a device's anonymous rows to the account on first sign-up.

    Skips when there is no real device id (``anon``) or it is already an
    account id, so we never merge one account's data into another.
    """
    if not device_id or device_id == "anon" or device_id.startswith("u:"):
        return
    for model in _OWNED:
        db.execute(
            update(model).where(model.client_id == device_id).values(client_id=owner_id)
        )
    db.commit()
