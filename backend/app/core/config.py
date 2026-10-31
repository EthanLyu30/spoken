"""Application settings loaded from environment / .env file.

All service credentials are optional so the app can boot (and the health
check can pass) before any API keys are configured. Feature services should
validate that their required keys are present when they are actually used.
"""

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_name: str = "Spoken"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Auth (JWT). Set a strong JWT_SECRET in production; the dev fallback is only
    # for local use. Tokens are short-lived so rotating the secret just forces
    # everyone to log in again.
    jwt_secret: str = ""
    jwt_expire_days: int = 30

    # Persistence
    database_url: str = "sqlite:///./spoken.db"

    # Content-free private operational telemetry; independent of learning data.
    telemetry_enabled: bool = True
    telemetry_retention_days: int = Field(default=14, ge=1, le=90)
    telemetry_max_records: int = Field(default=20_000, ge=100, le=100_000)
    # Optional one-shot owner binding for hosts without a server shell.
    admin_bootstrap_email: str = ""
    # Change only to explicitly authorize another one-shot server-side attempt.
    admin_bootstrap_attempt: str = Field(default="", max_length=128)

    # iFlytek (科大讯飞)
    xf_app_id: str = ""
    xf_api_key: str = ""
    xf_api_secret: str = ""

    # DeepSeek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    # DeepSeek routes this unversioned alias to its current Flash release.
    deepseek_model: Literal["deepseek-flash"] = "deepseek-flash"

    @field_validator("deepseek_model", mode="before")
    @classmethod
    def use_latest_flash(cls, value: object) -> str:
        """Migrate existing deployments to the rolling Flash alias, never Pro."""
        if value in (
            "deepseek-flash",
            "deepseek-v4-flash",
            "deepseek-v4-flash-vision-exp",
        ):
            return "deepseek-flash"
        raise ValueError(
            "Spoken only uses deepseek-flash; Pro and other models are not allowed"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor (single instance per process)."""
    return Settings()
