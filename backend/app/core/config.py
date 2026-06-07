"""Application settings loaded from environment / .env file.

All service credentials are optional so the app can boot (and the health
check can pass) before any API keys are configured. Feature services should
validate that their required keys are present when they are actually used.
"""

from functools import lru_cache

from pydantic import Field
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

    # iFlytek (科大讯飞)
    xf_app_id: str = ""
    xf_api_key: str = ""
    xf_api_secret: str = ""

    # DeepSeek
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings accessor (single instance per process)."""
    return Settings()
