"""Private, content-free operational records; separate from learning data."""
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AdminAccount(Base):
    __tablename__ = "admin_accounts"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)


class AdminBootstrap(Base):
    """Hashed email/attempt markers, retained even after a role is revoked."""
    __tablename__ = "admin_bootstraps"
    email_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TelemetryRecord(Base):
    __tablename__ = "telemetry_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    trace_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    interaction_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    operation: Mapped[str] = mapped_column(String(120), index=True)
    source: Mapped[str] = mapped_column(String(12), default="server", index=True)
    outcome: Mapped[str] = mapped_column(String(16))
    duration_ms: Mapped[float] = mapped_column(Float)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    release: Mapped[str] = mapped_column(String(80), default="unknown")
    spans_json: Mapped[str] = mapped_column(Text, default="[]")
