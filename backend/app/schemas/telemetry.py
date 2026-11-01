from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class BrowserTiming(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    operation: Literal["asr.transcribe", "asr.finalize", "speech.first_audio", "speech.playback", "speech.complete", "voice.first_audio", "voice.complete",
                       "chat.first_text", "chat.complete", "chat.tail", "speech.request_to_audio",
                       "speech.voice_resolution", "speech.final_text_to_audio", "speech.native_start", "speech.cloud_fetch", "speech.play_start"]
    duration_ms: float = Field(ge=0, le=300_000, strict=True)
    outcome: Literal["ok", "error", "cancelled"] = "ok"
    engine: Literal["local", "xfyun", "browser", "unknown"] = "unknown"
    transport: Literal["direct", "relay", "buffered", "local", "unknown"] = "unknown"
    interaction_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    release: str = Field(default="unknown", max_length=80, pattern=r"^[A-Za-z0-9._-]+$")

    reason: Literal["started", "startup_timeout", "end_before_start", "speech_error", "speak_exception", "cancelled"] | None = None
    error_code: Literal["canceled", "interrupted", "audio-busy", "audio-hardware", "network", "synthesis-unavailable", "synthesis-failed", "language-unavailable", "voice-unavailable", "text-too-long", "invalid-argument", "not-allowed", "unknown"] | None = None
    state_before: int | None = Field(default=None, ge=0, le=7, strict=True)
    state_after: int | None = Field(default=None, ge=0, le=7, strict=True)
    voice_type: Literal["enhanced", "remote", "local", "unknown"] | None = None
    voice_matched: bool | None = Field(default=None, strict=True)

    @model_validator(mode="after")
    def native_fields_only(self):
        if self.operation != "speech.native_start" and self.model_fields_set.intersection(
            {"reason", "error_code", "state_before", "state_after", "voice_type", "voice_matched"}
        ):
            raise ValueError("native fields require speech.native_start")
        return self
