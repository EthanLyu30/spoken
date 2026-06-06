"""Schema for AI-generated daily lines."""

from pydantic import BaseModel


class DailyLine(BaseModel):
    text: str
    author: str = "Anonymous"
    zh: str = ""
    usage: str = ""  # when / how to use the line (Chinese)


class DailyLinesResponse(BaseModel):
    lines: list[DailyLine]
