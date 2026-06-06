"""Schemas for the word bag."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=256)
    scenario_id: str = ""
    meaning: str = ""
    example: str = ""
    kind: str = "word"  # "word" or "sentence"


class WordUpdate(BaseModel):
    mastered: bool


class Word(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    meaning: str
    example: str
    scenario_id: str
    kind: str
    mastered: bool
    created_at: datetime
