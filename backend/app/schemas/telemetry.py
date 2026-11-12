from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


NATIVE_START_FIELDS = {"reason", "error_code", "state_before", "state_after", "voice_type", "voice_matched"}
NATIVE_END_FIELDS = {"reason", "error_code", "state_at_event", "watchdog_budget_ms", "pause_count", "resume_count", "paused_duration_ms", "visibility_state"}
ASR_ATTEMPT_FIELDS = {"stage", "attempt", "fallback_reason", "audio_bytes", "result_class"}
PRONUNCIATION_FIELDS = {"entry", "audio_bytes"}
PLAYBACK_FIELDS = {"playback_started", "reason", "error_code", "voice_type"}
TEST_FIELDS = {"test_run_id"}
GLOBAL_DIAGNOSTIC_FIELDS = {"test_run_id", "provider_code"}
SINK_DIAGNOSTIC_FIELDS = NATIVE_START_FIELDS | NATIVE_END_FIELDS | ASR_ATTEMPT_FIELDS | PRONUNCIATION_FIELDS | PLAYBACK_FIELDS | GLOBAL_DIAGNOSTIC_FIELDS


class BrowserTiming(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    operation: Literal["asr.transcribe", "asr.finalize", "asr.attempt", "speech.first_audio", "speech.playback", "speech.complete", "voice.first_audio", "voice.complete",
                       "chat.first_text", "chat.complete", "chat.tail", "speech.request_to_audio",
                       "speech.voice_resolution", "speech.final_text_to_audio", "speech.native_start", "speech.native_end", "speech.cloud_fetch", "speech.play_start",
                       "pronunciation.click_to_result", "pronunciation.stop_to_result"]
    duration_ms: float = Field(ge=0, le=3_600_000, strict=True)
    outcome: Literal["ok", "error", "timeout", "cancelled"] = "ok"
    engine: Literal["local", "xfyun", "browser", "unknown"] = "unknown"
    transport: Literal["direct", "relay", "buffered", "local", "unknown"] = "unknown"
    interaction_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    release: str = Field(default="unknown", max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    test_run_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    event_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    occurred_at_ms: int | None = Field(default=None, ge=0, le=9_007_199_254_740_991, strict=True)
    is_replay: bool | None = Field(default=None, strict=True)

    reason: Literal["started", "startup_timeout", "end_before_start", "speech_error", "speak_exception", "cancelled",
                    "end", "native_error", "completion_timeout"] | None = None
    error_code: Literal["canceled", "interrupted", "audio-busy", "audio-hardware", "network", "synthesis-unavailable", "synthesis-failed", "language-unavailable", "voice-unavailable", "text-too-long", "invalid-argument", "not-allowed", "unknown"] | None = None
    state_before: int | None = Field(default=None, ge=0, le=7, strict=True)
    state_after: int | None = Field(default=None, ge=0, le=7, strict=True)
    voice_type: Literal["enhanced", "remote", "local", "unknown"] | None = None
    voice_matched: bool | None = Field(default=None, strict=True)
    playback_started: bool | None = Field(default=None, strict=True)
    state_at_event: int | None = Field(default=None, ge=0, le=7, strict=True)
    watchdog_budget_ms: float | None = Field(default=None, ge=0, le=3_600_000, strict=True)
    pause_count: int | None = Field(default=None, ge=0, le=100, strict=True)
    resume_count: int | None = Field(default=None, ge=0, le=100, strict=True)
    paused_duration_ms: float | None = Field(default=None, ge=0, le=300_000, strict=True)
    visibility_state: Literal["visible", "hidden", "unknown"] | None = None

    stage: Literal["authorize", "open", "stream", "stream_final", "whole_clip", "http_buffered"] | None = None
    attempt: int | None = Field(default=None, ge=1, le=10, strict=True)
    fallback_reason: Literal["none", "timeout", "disconnect", "provider_error", "empty", "http_error", "unavailable", "unknown"] | None = None
    audio_bytes: int | None = Field(default=None, ge=0, le=5_760_000, strict=True)
    result_class: Literal["empty", "nonempty"] | None = None
    provider_code: int | None = Field(default=None, ge=1, le=99999, strict=True)
    asr_reason: Literal["empty", "incomplete", "timeout", "disconnect", "provider_error",
                        "http_error", "unavailable", "cancelled", "user_cancelled", "quota_cooldown", "unknown"] | None = None
    entry: Literal["turn_correction", "follow_read"] | None = None

    @property
    def durable_asr(self) -> bool:
        return bool(self.event_id) and self.operation.startswith("asr.") and self.outcome in {"error", "timeout"}

    @model_validator(mode="after")
    def operation_fields_only(self):
        if (self.occurred_at_ms is not None or self.is_replay is not None) and not self.durable_asr:
            raise ValueError("delivery metadata belongs to durable ASR failures")
        supplied = self.model_fields_set - GLOBAL_DIAGNOSTIC_FIELDS
        if "asr_reason" in supplied:
            expected = {"cancelled": "cancelled", "user_cancelled": "cancelled",
                        "timeout": "timeout"}.get(self.asr_reason, "error")
            if not self.operation.startswith("asr.") or self.outcome != expected or self.asr_reason is None:
                raise ValueError("invalid recognition failure classification")
        if self.operation != "speech.native_end" and self.duration_ms > 300_000:
            raise ValueError("duration_ms exceeds the operation limit")
        native_start_only = {"state_before", "state_after", "voice_type", "voice_matched"}
        native_end_only = NATIVE_END_FIELDS - {"reason", "error_code"}
        asr_only = ASR_ATTEMPT_FIELDS - {"audio_bytes"}
        if "playback_started" in supplied and self.operation != "speech.complete":
            raise ValueError("playback_started belongs to speech.complete")
        if self.operation == "speech.complete":
            if (supplied & SINK_DIAGNOSTIC_FIELDS) - PLAYBACK_FIELDS:
                raise ValueError("fields do not belong to speech.complete")
            if self.reason is None and supplied.intersection({"error_code", "voice_type"}):
                raise ValueError("recovery diagnostics require a reason")
            if self.reason is not None and (
                self.reason not in {"startup_timeout", "end_before_start", "speech_error"}
                or self.engine != "browser" or self.playback_started is None
                or self.voice_type not in {None, "remote", "enhanced"}
            ):
                raise ValueError("invalid playback recovery diagnostics")
        elif self.operation == "speech.native_start":
            if supplied.intersection(native_end_only | ASR_ATTEMPT_FIELDS | {"entry"}):
                raise ValueError("fields do not belong to speech.native_start")
            if self.reason in {"end", "native_error", "completion_timeout"}:
                raise ValueError("invalid speech.native_start reason")
        elif self.operation == "speech.native_end":
            if supplied.intersection(native_start_only | ASR_ATTEMPT_FIELDS | {"entry"}):
                raise ValueError("fields do not belong to speech.native_end")
            if self.reason not in {"end", "native_error", "completion_timeout", "cancelled"}:
                raise ValueError("speech.native_end requires a terminal reason")
        elif self.operation == "asr.attempt":
            if supplied.intersection(NATIVE_START_FIELDS | NATIVE_END_FIELDS | {"entry"}):
                raise ValueError("fields do not belong to asr.attempt")
            if self.stage is None or self.attempt is None:
                raise ValueError("asr.attempt requires stage and attempt")
            if self.stage in {"whole_clip", "http_buffered"} and self.audio_bytes is None:
                raise ValueError("buffered ASR attempts require audio_bytes")
        elif self.operation in {"pronunciation.click_to_result", "pronunciation.stop_to_result"}:
            if supplied.intersection(NATIVE_START_FIELDS | NATIVE_END_FIELDS | asr_only):
                raise ValueError("fields do not belong to pronunciation timing")
            if self.entry is None or self.audio_bytes is None:
                raise ValueError("pronunciation timing requires entry and audio_bytes")
        elif supplied.intersection(SINK_DIAGNOSTIC_FIELDS):
            raise ValueError("operation-specific fields are not allowed")
        return self
