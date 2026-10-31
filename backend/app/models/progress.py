"""Permanent, content-free learning receipts and earned achievements."""

from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class LearningEvent(Base):
    __tablename__ = "learning_events"
    __table_args__ = (
        Index("uq_learning_session_receipt", "client_id", "client_session_id", unique=True),
    )

    event_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_session_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    occurred_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    scenario_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str | None] = mapped_column(String(24), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    word_text: Mapped[str | None] = mapped_column(String(128), nullable=True)


class EarnedBadge(Base):
    __tablename__ = "earned_badges"
    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    badge_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    earned_at: Mapped[datetime] = mapped_column(DateTime)


class ProgressOwner(Base):
    """A transaction lock, never a mutable progress counter."""

    __tablename__ = "progress_owners"
    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)


class ProgressMigration(Base):
    __tablename__ = "progress_migrations"
    version: Mapped[int] = mapped_column(Integer, primary_key=True)
