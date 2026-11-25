from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.word import Word


Rating = Literal["familiar", "uncertain", "forgot"]


class StartRetest(BaseModel):
    include_scene: bool = False
    replace_id: str | None = Field(default=None, max_length=36)


class RetestRating(BaseModel):
    rating: Rating


class RetestItem(BaseModel):
    position: int
    word: Word


class RetestRound(BaseModel):
    id: str
    words: int = 0
    sentences: int = 0
    familiar: int = 0
    uncertain: int = 0
    forgot: int = 0
    skipped: int = 0
    next_item: RetestItem | None = None


class RetestState(BaseModel):
    words: int
    sentences: int
    unadded_scene: int
    round: RetestRound | None = None
