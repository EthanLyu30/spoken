"""Schemas for the word bag."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    scenario_id: str = ""
    meaning: str = ""
    example: str = ""
    kind: str = "word"  # word | phrase | sentence
    topic: str | None = Field(default=None, max_length=48)


class WordUpdate(BaseModel):
    mastered: bool | None = None
    topic: str | None = Field(default=None, max_length=48)


class WordTopicChange(BaseModel):
    source: str = Field(min_length=1, max_length=48)
    target: str | None = Field(max_length=48)


class WordTranslation(BaseModel):
    answer: str = Field(min_length=1, max_length=1200)


class WordTranslationGrade(BaseModel):
    verdict: Literal["equivalent", "partial", "different"]
    feedback: str = Field(min_length=1, max_length=160)


class WordReview(BaseModel):
    remembered: bool
    uncertain: bool = False
    client_request_id: str | None = Field(default=None, min_length=1, max_length=80)


class Word(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    meaning: str
    example: str
    scenario_id: str
    topic: str | None = None
    familiarity: Literal["familiar", "uncertain", "forgot"] | None = None
    kind: str
    mastered: bool
    created_at: datetime
    box: int = 0
    due_at: datetime | None = None
    last_reviewed: datetime | None = None
