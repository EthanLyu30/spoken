"""Schemas for account auth (register / login)."""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(v: str) -> str:
    return v.strip().lower()


class RegisterRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = _normalize_email(v)
        if not _EMAIL_RE.match(v):
            raise ValueError("邮箱格式不正确")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码至少 6 位")
        return v


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return _normalize_email(v)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str = ""
    avatar_url: str = ""
    created_at: datetime


class AuthResponse(BaseModel):
    token: str
    user: UserOut


_MAX_AVATAR = 400_000  # chars; a compressed ~128px data URL is far smaller


class ProfileUpdate(BaseModel):
    """Partial profile edit. Omitted fields are left unchanged."""

    display_name: str | None = None
    avatar_url: str | None = None

    @field_validator("display_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) > 40:
            raise ValueError("名字最多 40 个字符")
        return v

    @field_validator("avatar_url")
    @classmethod
    def _avatar(cls, v: str | None) -> str | None:
        if not v:  # None or "" both mean "clear / leave default"
            return v
        if not v.startswith("data:image/"):
            raise ValueError("头像格式不支持")
        if len(v) > _MAX_AVATAR:
            raise ValueError("头像太大了，请换张小图")
        return v
