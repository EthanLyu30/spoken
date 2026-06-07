"""ORM model for a registered account.

Accounts are optional: the app still works anonymously (per-device
``client_id``). Logging in resolves the data owner to ``u:<id>`` so all the
existing word/session/practice rows are scoped to the account instead.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Display profile (editable). avatar is a small data URL so it syncs across
    # devices without any external file storage.
    display_name: Mapped[str] = mapped_column(String(40), default="")
    avatar_url: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
