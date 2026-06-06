"""Request / response for in-conversation hints (suggested learner lines)."""

from pydantic import BaseModel, Field

from app.schemas.chat import ChatMessage


class HintRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=40)


class HintResponse(BaseModel):
    suggestions: list[str]
