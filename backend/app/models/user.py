"""ORM model for a registered account.

Accounts are optional: the app still works anonymously (per-device
``client_id``). Logging in resolves the data owner to ``u:<id>`` so all the
existing word/session/practice rows are scoped to the account instead.
"""

from __future__ import annotations

from datetime import datetime
import secrets

from sqlalchemy import DateTime, ForeignKey, String, Text
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
    auth_version: Mapped[str] = mapped_column(String(32), default=lambda: secrets.token_hex(16))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class AccountAction(Base):
    __tablename__ = "account_actions"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
