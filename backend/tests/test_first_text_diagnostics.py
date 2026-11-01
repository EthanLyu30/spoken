import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.core.config import Settings
from app.core import performance
from app.core.observability import TraceContext
from app.services import deepseek


@pytest.mark.parametrize('cancelled', [False, True])
def test_stream_distinguishes_headers_keepalive_and_first_content_without_logging_text(monkeypatch, cancelled):
    clock = SimpleNamespace(now=0.0)
    monkeypatch.setattr(deepseek, 'perf_counter', lambda: clock.now)
    monkeypatch.setattr(performance, 'perf_counter', lambda: clock.now)

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            clock.now = 0.15
            yield b': SECRET-UPSTREAM-KEEPALIVE\n\n'
            clock.now = 0.20
            yield b'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n'
            if cancelled:
                raise asyncio.CancelledError()
            clock.now = 0.40
            yield b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            clock.now = 0.70
            yield b'data: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n'

    async def transport(request):
        clock.now = 0.10
        return httpx.Response(200, stream=Body())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            with TraceContext('test') as trace:
                service = deepseek.DeepSeekClient(Settings(_env_file=None, deepseek_api_key='SECRET-KEY'), http_client=client)
                if cancelled:
                    with pytest.raises(asyncio.CancelledError):
                        _ = [delta async for delta in service.chat_stream([])]
                else:
                    assert [delta async for delta in service.chat_stream([])] == ['Hello', ' there']
            return trace

    trace = asyncio.run(run())
    values = trace.performance
    assert values['llm_response_headers'] == pytest.approx(100)
    assert values['llm_first_event'] == pytest.approx(150)
    assert values['llm_keepalives_before_text'] == 1
    if cancelled:
        assert 'llm_first_text' not in values
        assert 'llm_headers_to_text' not in values
        assert 'llm_total' not in values
    else:
        assert values['llm_first_text'] == pytest.approx(400)
        assert values['llm_headers_to_text'] == pytest.approx(300)
        assert values['llm_total'] == pytest.approx(700)
    assert 'SECRET' not in trace.record()['spans_json']
