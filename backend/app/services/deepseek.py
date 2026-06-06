"""Thin async client for the DeepSeek chat-completions API.

DeepSeek exposes an OpenAI-compatible ``/chat/completions`` endpoint, so this is
a small wrapper over ``httpx`` rather than a heavy SDK dependency.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import Settings, get_settings


class DeepSeekError(RuntimeError):
    """Raised when a DeepSeek request cannot be completed."""


class DeepSeekClient:
    """Calls DeepSeek's chat-completions endpoint.

    DeepSeek is a domestic (China) endpoint, so requests deliberately bypass any
    ``HTTP(S)_PROXY`` set in the environment (``trust_env=False``).
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 300,
        response_format: dict | None = None,
    ) -> str:
        settings = self._settings
        if not settings.deepseek_api_key:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
        payload: dict = {
            "model": settings.deepseek_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if response_format is not None:
            payload["response_format"] = response_format
        headers = {
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(
                trust_env=False,
                timeout=httpx.Timeout(60.0, connect=10.0),
            ) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            raise DeepSeekError(
                f"DeepSeek returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise DeepSeekError("Unexpected DeepSeek response shape") from exc

        if not content or not content.strip():
            raise DeepSeekError("DeepSeek returned an empty reply")
        return content.strip()

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.85,
        max_tokens: int = 300,
    ) -> AsyncIterator[str]:
        """Yield reply content deltas as they arrive (Server-Sent Events)."""
        settings = self._settings
        if not settings.deepseek_api_key:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": settings.deepseek_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(
                trust_env=False, timeout=httpx.Timeout(60.0, connect=10.0)
            ) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            delta = json.loads(data)["choices"][0]["delta"].get("content")
                        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                            continue
                        if delta:
                            yield delta
        except httpx.HTTPStatusError as exc:
            raise DeepSeekError(
                f"DeepSeek returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc
