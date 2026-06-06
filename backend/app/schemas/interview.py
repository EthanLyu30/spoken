"""Schemas for the timed Q&A (TOEFL-style speaking) module."""

from pydantic import BaseModel, Field


class InterviewQuestions(BaseModel):
    questions: list[str]


class InterviewItem(BaseModel):
    question: str = Field(min_length=1, max_length=400)
    answer: str = Field(default="", max_length=4000)


class InterviewScoreRequest(BaseModel):
    items: list[InterviewItem] = Field(min_length=1, max_length=6)


class InterviewResult(BaseModel):
    question: str
    answer: str
    score: int = Field(ge=0, le=30)
    level: str
    feedback: str
    sample_answer: str


class InterviewScoreResponse(BaseModel):
    overall: int = Field(ge=0, le=30)
    results: list[InterviewResult]
