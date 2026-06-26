"""Request / response for in-conversation hints (suggested learner lines)."""

from pydantic import BaseModel, Field

from app.schemas.chat import ChatMessage
from app.schemas.custom import CustomScene


class HintRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    messages: list[ChatMessage] = Field(default_factory=list, max_length=40)
    # When present, hint for this user-defined scene (custom / 今日新场景)
    # instead of a catalogue entry — mirrors ChatRequest.custom.
    custom: CustomScene | None = None


class HintResponse(BaseModel):
    suggestions: list[str]
