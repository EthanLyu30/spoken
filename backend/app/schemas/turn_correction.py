"""Schemas for on-demand feedback on one learner turn."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.custom import CustomScene


class TurnCorrectionIssue(BaseModel):
    kind: Literal["grammar", "expression"]
    original: str = Field(min_length=1, max_length=300)
    replacement: str = Field(min_length=1, max_length=300)
    note: str = Field(min_length=1, max_length=500)


class TurnCorrectionRequest(BaseModel):
    scenario_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=600)
    previous_partner_message: str = Field(default="", max_length=600)
    custom: CustomScene | None = None

    @field_validator("text")
    @classmethod
    def strip_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("text must not be blank")
        return value

    @field_validator("previous_partner_message")
    @classmethod
    def strip_context(cls, value: str) -> str:
        return value.strip()


class TurnCorrectionResponse(BaseModel):
    original: str
    natural: bool
    suggestion: str = Field(min_length=1, max_length=800)
    issues: list[TurnCorrectionIssue] = Field(default_factory=list, max_length=6)
    explanation: str = Field(min_length=1, max_length=800)
