"""Schema for AI-generated daily lines."""

from pydantic import BaseModel


class DailyLine(BaseModel):
    text: str
    author: str = "Anonymous"
    zh: str = ""


class DailyLinesResponse(BaseModel):
    lines: list[DailyLine]
