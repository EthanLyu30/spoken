"""Public feedback payloads. Only the review endpoint accepts an award."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.auth import _EMAIL_RE, _normalize_email

Category = Literal["ui", "feature", "bug", "learning", "other"]
Source = Literal["home", "profile", "scene_report", "interview_result", "direct"]
Award = Literal[10, 25, 50]


def normalize_feedback_email(value: str) -> str:
    value = _normalize_email(value)
    if not _EMAIL_RE.fullmatch(value):
        raise ValueError("邮箱格式不正确")
    return value


class SubmitFeedback(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    request_id: str = Field(pattern=r"^[a-f0-9]{32}$", repr=False)
    category: Category
    description: str = Field(min_length=6, max_length=1500)
    source: Source = "direct"
    allow_ai: bool = False
    email: str | None = Field(default=None, max_length=255, repr=False)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        return normalize_feedback_email(value) if value else None


class FeedbackEmail(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=255)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str | None) -> str | None:
        return normalize_feedback_email(value) if value is not None else None


class VerifyFeedbackEmail(BaseModel):
    token: str = Field(pattern=r"^[a-f0-9]{64}$")


class ClaimFeedback(BaseModel):
    wechat: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")


class ReviewFeedback(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    decision: Literal["award", "more_info", "no_award"]
    amount: Award | None = None
    note: str = Field(min_length=2, max_length=300)

    @model_validator(mode="after")
    def check_amount(self):
        if (self.decision == "award") != (self.amount is not None):
            raise ValueError("通过奖励时请选择一个奖励档位")
        return self


class SupplementFeedback(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    description: str = Field(min_length=6, max_length=500)


class RecordPayout(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    reference: str = Field(min_length=4, max_length=120)


class ReconcilePayout(RecordPayout):
    decision: Literal["paid", "released"]
