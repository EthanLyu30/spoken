"""Request schema for text-to-speech."""

from pydantic import BaseModel, Field


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    # Optional: pick the scenario partner's voice.
    scenario_id: str | None = None
