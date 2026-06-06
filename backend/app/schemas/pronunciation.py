"""Schemas for pronunciation assessment (iFlytek ISE)."""

from pydantic import BaseModel


class WordScore(BaseModel):
    word: str
    score: float  # 0-100


class PronunciationResult(BaseModel):
    overall: float
    accuracy: float
    fluency: float
    integrity: float
    standard: float
    words: list[WordScore]
