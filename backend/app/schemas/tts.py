"""Request schema for text-to-speech."""

from pydantic import BaseModel, Field, field_validator
from app.data.tts_voices import normalize_cloud_voice


class TtsRequest(BaseModel):
    # The v2 provider requires the original UTF-8 text to be smaller than 8000 bytes.
    text: str = Field(min_length=1, max_length=7999)
    # Optional: pick the scenario partner's voice.
    scenario_id: str | None = None
    # Optional user overrides; fall back to the scenario voice when omitted.
    vcn: str | None = None
    speed: int | None = Field(default=None, ge=0, le=100)
    pitch: int | None = Field(default=None, ge=0, le=100)

    @field_validator("vcn")
    @classmethod
    def validate_voice(cls, value: str | None) -> str | None:
        return normalize_cloud_voice(value) if value is not None else None

    @field_validator("text")
    @classmethod
    def validate_text_bytes(cls, value: str) -> str:
        if len(value.encode("utf-8")) >= 8000:
            raise ValueError("Text must be smaller than 8000 UTF-8 bytes")
        return value
