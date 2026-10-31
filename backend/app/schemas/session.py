"""Schemas for saving and reading practice sessions."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.chat import ChatMessage
from app.schemas.feedback import SkillScore
from app.schemas.practice import Insights


class SaveSessionRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    client_session_id: str | None = Field(default=None, min_length=1, max_length=64)
    messages: list[ChatMessage] = Field(min_length=1, max_length=1000)
    overall: int = Field(ge=0, le=100)
    summary: str = ""
    tip: str = ""
    scores: list[SkillScore] = Field(default_factory=list)


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scenario_id: str
    overall: int
    created_at: datetime


class SessionDetail(SessionSummary):
    summary: str
    tip: str
    scores: list[SkillScore]
    messages: list[ChatMessage]


class LatestSessionScores(BaseModel):
    id: int
    scores: list[SkillScore]


class ProgressSessions(BaseModel):
    sessions: list[SessionSummary]
    insights: Insights
    latest: LatestSessionScores | None


class ExpiredSessionReceipt(SessionSummary):
    # Historical unknown timestamps must remain unknown, never invented.
    created_at: datetime | None
    detail_available: Literal[False] = False
