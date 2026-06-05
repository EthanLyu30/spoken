"""Request / response models for the dialogue (chat) endpoint."""

from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: Role
    content: str = Field(min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    scenario_id: str = Field(min_length=1)
    # Conversation so far, oldest first. May be empty to request the opener.
    messages: list[ChatMessage] = Field(default_factory=list, max_length=40)


class ChatResponse(BaseModel):
    scenario_id: str
    reply: str
    # True when the reply is the scripted scene opener (no model call was made).
    opening: bool = False
