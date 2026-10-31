"""Thin async client for the DeepSeek chat-completions API.

DeepSeek exposes an OpenAI-compatible ``/chat/completions`` endpoint, so this is
a small wrapper over ``httpx`` rather than a heavy SDK dependency.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter

import httpx

from app.core.config import Settings, get_settings
from app.core.observability import traced, traced_stream, trace_attribute
from app.core.performance import HttpTimings, elapsed


def _usage(data):
    usage = data.get("usage") if isinstance(data, dict) else None
    if isinstance(usage, dict):
        for source, target in (("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens")):
            value = usage.get(source)
            if type(value) is int and 0 <= value <= 10_000_000:
                trace_attribute(target, value)


class DeepSeekError(RuntimeError):
    """Raised when a DeepSeek request cannot be completed."""


def create_http_client() -> httpx.AsyncClient:
    """Create within the owning event loop; never share clients across lifespans."""
    return httpx.AsyncClient(
        trust_env=False,
        timeout=httpx.Timeout(60.0, connect=10.0),
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=60.0),
    )


class DeepSeekClient:
    """Calls DeepSeek's chat-completions endpoint.

    DeepSeek is a domestic (China) endpoint, so requests deliberately bypass any
    ``HTTP(S)_PROXY`` set in the environment (``trust_env=False``).
    """

    def __init__(self, settings: Settings | None = None, *, http_client: httpx.AsyncClient | None = None) -> None:
        self._settings = settings or get_settings()
        self._http_client = http_client

    @asynccontextmanager
    async def _client(self):
        if self._http_client is not None:
            # Only application lifespan owns/tears down this connection pool.
            yield self._http_client
        else:
            # Scripts and tests retain the standalone, per-call ownership path.
            async with create_http_client() as client:
                yield client

    @traced("deepseek.chat", provider="deepseek")
    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.7,
        max_tokens: int = 300,
        response_format: dict | None = None,
    ) -> str:
        settings = self._settings
        trace_attribute("model", settings.deepseek_model)
        if not settings.deepseek_api_key:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
        payload: dict = {
            "model": settings.deepseek_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
            "thinking": {"type": "disabled"},
        }
        if response_format is not None:
            payload["response_format"] = response_format
        headers = {
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        }

        request_start = perf_counter()
        try:
            async with self._client() as client:
                # HTTPX post() fully reads and closes the response stream before
                # returning, including cleanup on cancellation/read failure.
                resp = await client.post(url, json=payload, headers=headers, extensions={"trace": HttpTimings()})
                resp.raise_for_status()
                data = resp.json()
                _usage(data)
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
        # Non-streaming text is first observable only after the full JSON body.
        elapsed("llm_first_text", request_start)
        elapsed("llm_total", request_start)
        return content.strip()

    @traced_stream("deepseek.stream", provider="deepseek")
    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.85,
        max_tokens: int = 300,
    ) -> AsyncIterator[str]:
        """Yield reply content deltas as they arrive (Server-Sent Events)."""
        settings = self._settings
        trace_attribute("model", settings.deepseek_model)
        if not settings.deepseek_api_key:
            raise DeepSeekError("DEEPSEEK_API_KEY is not configured")

        url = f"{settings.deepseek_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": settings.deepseek_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "thinking": {"type": "disabled"},
        }
        headers = {
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "Content-Type": "application/json",
        }

        request_start = perf_counter()
        first_text = True
        try:
            async with self._client() as client:
                async with client.stream("POST", url, json=payload, headers=headers, extensions={"trace": HttpTimings()}) as resp:
                    resp.raise_for_status()
                    completed = False
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            completed = True
                            elapsed("llm_total", request_start)
                            break
                        try:
                            packet = json.loads(data)
                            _usage(packet)
                            if isinstance(packet, dict) and packet.get("error"):
                                raise DeepSeekError("DeepSeek reported a streaming error")
                            delta = packet["choices"][0]["delta"].get("content")
                        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
                            continue
                        if delta:
                            if first_text:
                                elapsed("llm_first_text", request_start)
                                first_text = False
                            yield delta
                    if not completed:
                        raise DeepSeekError("DeepSeek stream ended before completion")
        except httpx.HTTPStatusError as exc:
            raise DeepSeekError(
                f"DeepSeek returned HTTP {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc
