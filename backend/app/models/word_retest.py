"""The current assessment and its frozen set of word incarnations."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class WordRetest(Base):
    __tablename__ = "word_retests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), unique=True)


class WordRetestItem(Base):
    __tablename__ = "word_retest_items"

    retest_id: Mapped[str] = mapped_column(ForeignKey("word_retests.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer, primary_key=True)
    word_id: Mapped[int] = mapped_column(Integer)
    word_created_at: Mapped[datetime] = mapped_column(DateTime)
    kind: Mapped[str] = mapped_column(String(16))
    rating: Mapped[str | None] = mapped_column(String(16), nullable=True)
