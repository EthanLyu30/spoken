"""Schemas for practice records and aggregate learner stats."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PracticeCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=24)  # pronunciation | interview
    score: float = Field(ge=0, le=100)  # native scale (pronunciation 0-100, interview 0-6)
    title: str = Field(default="", max_length=200)
    detail: str = Field(default="", max_length=8000)


class PracticeRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    score: float
    title: str
    created_at: datetime


class Stats(BaseModel):
    streak_days: int
    today_count: int
    today_goal: int
    level: int
    xp: int
    xp_to_next: int
    total_sessions: int
    total_practice: int
    words_count: int


class SkillInsight(BaseModel):
    """A single ability dimension averaged over the learner's recent sessions,
    with a short-term trend (later half vs earlier half of those sessions)."""

    key: str
    label_zh: str
    label_en: str
    avg: int  # mean score over recent sessions, 0-100
    delta: int  # later-half avg minus earlier-half avg (>0 improving)
    samples: int


class Insights(BaseModel):
    available: bool  # False when there aren't yet any scored sessions
    sessions: int  # how many recent sessions fed the analysis
    overall_delta: int  # mean per-skill delta — overall direction of travel
    weakest: SkillInsight | None = None  # the dimension to focus on next
    strongest: SkillInsight | None = None
    skills: list[SkillInsight] = Field(default_factory=list)  # weakest first
