"""Schemas and validation for short English dictionary lookups."""

import re

from pydantic import BaseModel, Field, field_validator

_WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")


def normalize_dictionary_query(raw: str) -> str:
    value = re.sub(r"\s+", " ", raw.strip())
    value = re.sub(r"^[^A-Za-z]+|[^A-Za-z'-]+$", "", value)
    if not value or not _WORD_RE.search(value):
        raise ValueError("query must contain English letters")
    if len(value) > 80:
        raise ValueError("query is too long")
    if len(_WORD_RE.findall(value)) > 6:
        raise ValueError("query contains more than six words")
    return value


class DictionaryLookupRequest(BaseModel):
    query: str = Field(min_length=1, max_length=120)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        return normalize_dictionary_query(value)


class DictionaryEntry(BaseModel):
    query: str
    phonetic: str = Field(default="", max_length=120)
    part_of_speech: str = Field(default="", max_length=80)
    meaning: str = Field(min_length=1, max_length=600)
    example: str = Field(min_length=1, max_length=600)
    example_zh: str = Field(min_length=1, max_length=600)
