from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class BrowserTiming(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    operation: Literal["asr.transcribe", "asr.finalize", "speech.first_audio", "speech.complete", "voice.first_audio", "voice.complete"]
    duration_ms: float = Field(ge=0, le=300_000, strict=True)
    outcome: Literal["ok", "error", "cancelled"] = "ok"
    engine: Literal["local", "xfyun", "browser", "unknown"] = "unknown"
    transport: Literal["direct", "relay", "buffered", "local", "unknown"] = "unknown"
    interaction_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    release: str = Field(default="unknown", max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
