"""ORM models for persisted practice sessions (basis for history + trends)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _utcnow() -> datetime:
    return datetime.utcnow()


class PracticeSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    scenario_id: Mapped[str] = mapped_column(String(64), index=True)
    overall: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(Text, default="")
    tip: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)

    turns: Mapped[list[Turn]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Turn.idx"
    )
    scores: Mapped[list[SkillScore]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class Turn(Base):
    __tablename__ = "turns"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    idx: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)

    session: Mapped[PracticeSession] = relationship(back_populates="turns")


class SkillScore(Base):
    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    key: Mapped[str] = mapped_column(String(32))
    label_en: Mapped[str] = mapped_column(String(64))
    label_zh: Mapped[str] = mapped_column(String(64))
    score: Mapped[int] = mapped_column(Integer)

    session: Mapped[PracticeSession] = relationship(back_populates="scores")
