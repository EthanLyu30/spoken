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
