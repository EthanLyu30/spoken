"""Schemas for the post-session feedback endpoint."""

from pydantic import BaseModel, Field

from app.schemas.chat import ChatMessage
from app.schemas.custom import CustomScene


class SkillScore(BaseModel):
    key: str
    label_en: str
    label_zh: str
    score: int = Field(ge=0, le=100)


class Correction(BaseModel):
    original: str
    suggestion: str
    note: str


class Phrase(BaseModel):
    text: str
    note: str


class FeedbackRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=60)
    # When present, assess against this user-defined scene (see ChatRequest).
    custom: CustomScene | None = None


class FeedbackResponse(BaseModel):
    scenario_id: str
    overall: int = Field(ge=0, le=100)
    summary: str
    scores: list[SkillScore]
    corrections: list[Correction]
    phrases: list[Phrase]
    tip: str
