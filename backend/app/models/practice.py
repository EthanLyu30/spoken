"""ORM model for individual practice records (pronunciation / timed Q&A).

These feed the learner's history curves and the real activity stats (streak,
level, XP, daily goal) that replace the earlier mocked numbers.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _utcnow() -> datetime:
    return datetime.utcnow()


class PracticeRecord(Base):
    __tablename__ = "practice_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), default="anon", index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)  # pronunciation | interview
    score: Mapped[float] = mapped_column(Float, default=0.0)  # native scale per kind
    title: Mapped[str] = mapped_column(String(200), default="")
    detail: Mapped[str] = mapped_column(Text, default="")  # optional JSON
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)
