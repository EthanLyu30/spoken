"""Schemas for pronunciation assessment (iFlytek ISE)."""

from pydantic import BaseModel


class PhonemeScore(BaseModel):
    label: str  # ARPAbet phoneme, e.g. "hh"
    ok: bool  # True when iFlytek flagged no error (dp_message == 0)


class WordScore(BaseModel):
    word: str
    score: float  # 0-100
    phonemes: list[PhonemeScore] = []


class PronunciationResult(BaseModel):
    overall: float
    accuracy: float
    fluency: float
    integrity: float
    standard: float
    words: list[WordScore]
