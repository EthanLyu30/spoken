import asyncio

from app.core.config import Settings
from app.services import deepseek


class _FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"choices": [{"message": {"content": "Hello!"}}]}


class _FakeStreamResponse:
    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"Hello"}}]}'
        yield "data: [DONE]"


class _FakeAsyncClient:
    payloads: list[dict] = []

    def __init__(self, **_kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, _exc_type, _exc, _traceback) -> None:
        return None

    async def post(self, _url: str, *, json: dict, headers: dict):
        self.payloads.append(json)
        return _FakeResponse()

    def stream(self, _method: str, _url: str, *, json: dict, headers: dict):
        self.payloads.append(json)
        return _FakeStreamResponse()


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        deepseek_api_key="test-key",
        deepseek_model="deepseek-v4-flash",
    )


def test_default_model_uses_v4_flash():
    assert Settings(_env_file=None).deepseek_model == "deepseek-v4-flash"


def test_chat_disables_thinking(monkeypatch):
    _FakeAsyncClient.payloads.clear()
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", _FakeAsyncClient)

    result = asyncio.run(
        deepseek.DeepSeekClient(_settings()).chat(
            [{"role": "user", "content": "Hello"}]
        )
    )

    assert result == "Hello!"
    assert _FakeAsyncClient.payloads == [
        {
            "model": "deepseek-v4-flash",
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.7,
            "max_tokens": 300,
            "stream": False,
            "thinking": {"type": "disabled"},
        }
    ]


def test_chat_stream_disables_thinking(monkeypatch):
    _FakeAsyncClient.payloads.clear()
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", _FakeAsyncClient)

    async def collect_chunks() -> list[str]:
        return [
            chunk
            async for chunk in deepseek.DeepSeekClient(_settings()).chat_stream(
                [{"role": "user", "content": "Hello"}]
            )
        ]

    chunks = asyncio.run(collect_chunks())

    assert chunks == ["Hello"]
    assert _FakeAsyncClient.payloads == [
        {
            "model": "deepseek-v4-flash",
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.85,
            "max_tokens": 300,
            "stream": True,
            "thinking": {"type": "disabled"},
        }
    ]
