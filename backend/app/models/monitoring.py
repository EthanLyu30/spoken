"""Private, pseudonymous daily activity and content-free monitor timestamps."""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SiteVisit(Base):
    __tablename__ = 'site_visits'
    __table_args__ = (UniqueConstraint('day', 'kind', 'subject_hash', name='uq_site_visit_day_subject'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(12))
    subject_hash: Mapped[str] = mapped_column(String(64))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, index=True)


class MonitoringState(Base):
    __tablename__ = 'monitoring_state'
    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime)
