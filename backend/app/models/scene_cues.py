"""A learner's edited preparation list for one catalogue scene or custom lesson."""

from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ScenePreparation(Base):
    __tablename__ = "scene_preparations"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    scene_key: Mapped[str] = mapped_column(String(80), primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    revision: Mapped[int] = mapped_column(Integer)
    cues: Mapped[list[dict[str, str]]] = mapped_column(JSON)
