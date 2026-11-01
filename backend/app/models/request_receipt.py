"""Small durable mutation receipts; never store private answer bodies."""

from sqlalchemy import Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RequestReceipt(Base):
    __tablename__ = "request_receipts"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    operation: Mapped[str] = mapped_column(String(24), primary_key=True)
    client_request_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[int] = mapped_column(Integer)
    event_key: Mapped[str] = mapped_column(String(80))
    # Immutable practice response metadata; review receipts need no response copy.
    response_metadata: Mapped[str] = mapped_column(Text)
