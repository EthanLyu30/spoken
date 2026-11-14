"""Feedback tickets and the cash reserved for one pilot."""
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FeedbackPilot(Base):
    __tablename__ = "feedback_pilots"
    __table_args__ = (CheckConstraint("committed_amount BETWEEN 0 AND 200"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    committed_amount: Mapped[int] = mapped_column(Integer, default=0)


class ProductFeedback(Base):
    __tablename__ = "product_feedback"
    __table_args__ = (CheckConstraint("amount IN (0, 10, 25, 50)"),)

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    request_digest: Mapped[str] = mapped_column(String(64))
    owner_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    pilot_id: Mapped[str | None] = mapped_column(String(32), index=True, nullable=True)
    category: Mapped[str] = mapped_column(String(24))
    description: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(24))
    supplement: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    ai_status: Mapped[str] = mapped_column(String(24), default="pending")
    ai_result: Mapped[str] = mapped_column(Text, default="")
    ai_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[int] = mapped_column(Integer, default=0)
    claim_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    wechat: Mapped[str | None] = mapped_column(String(32), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payout_recorded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    payout_recorded_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payout_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    removed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verify_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_mail_status: Mapped[str] = mapped_column(String(20), default="pending")
    verification_mail_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    owner_mail_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    owner_mail_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result_mail_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result_mail_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result_mail_ai_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_mail_status: Mapped[str] = mapped_column(String(20), default="pending")
    result_mail_status: Mapped[str] = mapped_column(String(20), default="pending")
