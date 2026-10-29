"""Schemas for the timed Q&A (TOEFL-style speaking) module."""

from typing import Literal

from pydantic import BaseModel, Field


class InterviewQuestions(BaseModel):
    questions: list[str]
    set_id: str = ""
    topic: str = ""
    topic_en: str = ""
    intro: str = ""
    hints: list[str] = Field(default_factory=list)
    source_title: str = ""
    source_url: str = ""
    source_kind: str = "official_adapted"
    reviewed_at: str = ""
    collection: Literal["inspire", "ets"] = "ets"
    episode: int | None = None


class InterviewItem(BaseModel):
    question: str = Field(min_length=1, max_length=400)
    answer: str = Field(default="", max_length=4000)


class InterviewScoreRequest(BaseModel):
    items: list[InterviewItem] = Field(min_length=1, max_length=6)
    set_id: str | None = Field(default=None, min_length=1, max_length=100)


class InterviewResult(BaseModel):
    question: str
    answer: str
    score: int = Field(ge=0, le=6)  # TOEFL-style per-question band, 0-6
    level: str
    feedback: str
    sample_answer: str
    sample_source: Literal["video_reference", "ai_generated"] = "ai_generated"
    sample_source_url: str | None = None
    sample_word_count: int = Field(default=0, ge=0)
    sample_estimated_seconds: int = Field(default=0, ge=0)


class InterviewScoreResponse(BaseModel):
    overall: float = Field(ge=0, le=6)
    results: list[InterviewResult]
