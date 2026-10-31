"""Offline ownership/cancellation tests for the lifespan HTTP pool."""
import asyncio

import httpx
import pytest
from fastapi import FastAPI, Request

from app.api.chat import get_client
from app.core.config import Settings
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app import main


def test_injected_client_serves_complete_and_stream_requests_without_closing_pool():
    async def run():
        responses = []
        async def handler(request):
            if b'"stream":true' in request.content:
                response = httpx.Response(200, text='data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n')
            else:
                response = httpx.Response(200, json={"choices": [{"message": {"content": "Hello"}}]})
            responses.append(response)
            return response
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            service = DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test"), http_client=http)
            assert await service.chat([]) == "Hello"
            assert [part async for part in service.chat_stream([])] == ["Hello"]
            assert await service.chat([]) == "Hello"
            assert not http.is_closed
            assert all(response.is_closed for response in responses)
    asyncio.run(run())


def test_cancelled_stream_closes_response_but_sibling_and_later_requests_survive():
    class Body(httpx.AsyncByteStream):
        closed = 0
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            await asyncio.Event().wait()
        async def aclose(self):
            self.closed += 1
    async def run():
        body = Body()
        async def handler(request):
            if b'"stream":true' in request.content:
                return httpx.Response(200, stream=body)
            return httpx.Response(200, json={"choices": [{"message": {"content": "Sibling"}}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            service = DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test"), http_client=http)
            stream = service.chat_stream([])
            assert await anext(stream) == "Hello"
            pending = asyncio.create_task(anext(stream))
            assert await service.chat([]) == "Sibling"
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert body.closed == 1
            assert not http.is_closed
            assert await service.chat([]) == "Sibling"
    asyncio.run(run())


def test_http_error_closes_response_without_closing_shared_client():
    async def run():
        response = httpx.Response(503, text="unavailable")
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response)) as http:
            service = DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test"), http_client=http)
            with pytest.raises(DeepSeekError):
                await service.chat([])
            assert response.is_closed
            assert not http.is_closed
    asyncio.run(run())


def test_nonstream_body_cancellation_releases_response_without_poisoning_sibling():
    class Body(httpx.AsyncByteStream):
        closed = 0
        async def __aiter__(self):
            await asyncio.Event().wait()
            yield b""
        async def aclose(self):
            self.closed += 1
    async def run():
        body = Body()
        entered = asyncio.Event()
        async def handler(request):
            if not entered.is_set():
                entered.set()
                return httpx.Response(200, stream=body)
            return httpx.Response(200, json={"choices": [{"message": {"content": "Sibling"}}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            service = DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test"), http_client=http)
            pending = asyncio.create_task(service.chat([]))
            await entered.wait()
            pending.cancel()
            with pytest.raises(asyncio.CancelledError):
                await pending
            assert body.closed == 1 and not http.is_closed
            assert await service.chat([]) == "Sibling"
    asyncio.run(run())


def test_standalone_calls_own_fresh_clients_without_lifespan(monkeypatch):
    clients = []
    real_factory = httpx.AsyncClient
    def create(**options):
        client = real_factory(**options, transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "Hello"}}]})))
        clients.append(client)
        return client
    monkeypatch.setattr("app.services.deepseek.httpx.AsyncClient", create)
    service = DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test"))
    for _ in range(2):
        assert asyncio.run(service.chat([])) == "Hello"
    assert len(clients) == 2 and all(client.is_closed for client in clients)


@pytest.mark.parametrize("failure", [None, "bootstrap", "retention_start", "retention_close"])
def test_lifespan_client_is_bounded_closed_once_and_state_cleared(monkeypatch, failure):
    created = []
    real_factory = httpx.AsyncClient
    class Http(real_factory):
        closes = 0
        async def aclose(self):
            self.closes += 1
            await super().aclose()
        async def __aexit__(self, *args):
            await self.aclose()
    def factory(**kwargs):
        instance = Http(**kwargs)
        created.append((instance, kwargs))
        return instance
    def bootstrap():
        if failure == "bootstrap":
            raise RuntimeError("test startup")
    class Retention:
        async def start(self):
            if failure == "retention_start":
                raise RuntimeError("test startup")
        async def close(self):
            if failure == "retention_close":
                raise RuntimeError("test shutdown")
    monkeypatch.setattr("app.services.deepseek.httpx.AsyncClient", factory)
    monkeypatch.setattr(main, "configured_bootstrap_admin", bootstrap)
    monkeypatch.setattr(main, "RetentionWorker", Retention)
    monkeypatch.setattr(main, "get_settings", lambda: Settings(_env_file=None, telemetry_enabled=False))
    application = FastAPI()
    async def run():
        async with main.lifespan(application):
            http = application.state.deepseek_http
            request = Request({"type": "http", "app": application})
            assert get_client(request)._http_client is http
            assert not http.is_closed
    for _ in range(2):  # Independent event loops/lifespans never inherit a client.
        if failure:
            with pytest.raises(RuntimeError):
                asyncio.run(run())
        else:
            asyncio.run(run())
        assert getattr(application.state, "deepseek_http", None) is None
        assert getattr(application.state, "public_tts_cache", None) is None
    assert len(created) == 2
    assert created[0][0] is not created[1][0]
    for http, options in created:
        assert http.is_closed and http.closes == 1
        assert options["trust_env"] is False
        assert options["timeout"].read == 60 and options["timeout"].connect == 10
        limits = options["limits"]
        assert (limits.max_connections, limits.max_keepalive_connections, limits.keepalive_expiry) == (20, 10, 60)
