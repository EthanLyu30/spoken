"""Request schema for text-to-speech."""

from pydantic import BaseModel, Field


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    # Optional: pick the scenario partner's voice.
    scenario_id: str | None = None
    # Optional user overrides; fall back to the scenario voice when omitted.
    vcn: str | None = None
    speed: int | None = Field(default=None, ge=0, le=100)
    pitch: int | None = Field(default=None, ge=0, le=100)
