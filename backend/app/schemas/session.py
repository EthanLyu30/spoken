"""Schemas for saving and reading practice sessions."""

from datetime import datetime
from hashlib import sha256
import json
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from app.schemas.chat import ChatMessage
from app.schemas.coaching import PracticeExercise
from app.schemas.custom import CustomScene
from app.schemas.feedback import Correction, CorrectionFocus, SkillScore
from app.schemas.practice import Insights


class SessionScene(CustomScene):
    practice_exercises: list[PracticeExercise] | None = Field(default=None, min_length=2, max_length=2)

    def identity(self) -> str:
        """Match scene cues and saved turns across display labels and default fields."""
        content = self.model_dump(exclude={"source", "rehearsal_theme"})
        canonical = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return sha256(canonical.encode("utf-8")).hexdigest()


class CustomSceneLookup(BaseModel):
    custom: SessionScene


class SaveSessionRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    client_session_id: str | None = Field(default=None, min_length=1, max_length=64)
    messages: list[ChatMessage] = Field(min_length=1, max_length=1000)
    overall: int | None = Field(ge=0, le=100)
    summary: str = ""
    tip: str = ""
    scores: list[SkillScore] = Field(default_factory=list)
    corrections: list[Correction] = Field(default_factory=list)
    custom: SessionScene | None = None

    @model_validator(mode="after")
    def validate_unscored_attempt(self):
        if self.overall is None and (not self.client_session_id or self.scores):
            raise ValueError("Unscored sessions require a practice ID and cannot include scores")
        return self


class SessionSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scenario_id: str
    overall: int | None = Field(validation_alias=AliasChoices("reported_score", "overall"))
    created_at: datetime


class SessionDetail(SessionSummary):
    client_session_id: str | None = None
    summary: str
    tip: str
    scores: list[SkillScore]
    messages: list[ChatMessage]
    corrections: list[Correction] = Field(default_factory=list)
    custom: SessionScene | None = None


class LatestSessionScores(BaseModel):
    id: int
    scores: list[SkillScore]


class ProgressSessions(BaseModel):
    sessions: list[SessionSummary]
    insights: Insights
    latest: LatestSessionScores | None
    correction_focus: list[CorrectionFocus] = Field(default_factory=list)


class ExpiredSessionReceipt(SessionSummary):
    # Historical unknown timestamps must remain unknown, never invented.
    created_at: datetime | None
    detail_available: Literal[False] = False
