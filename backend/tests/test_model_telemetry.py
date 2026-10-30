import asyncio
import json

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.observability import TraceContext
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.api import chat as chat_api
from app.main import app


class Response:
    def raise_for_status(self):
        pass
    def json(self):
        return {'choices': [{'message': {'content': 'Hello!'}}],
                'usage': {'prompt_tokens': 27, 'completion_tokens': 9}}
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":""}}]}'
        yield 'data: {"choices":[{"delta":{"content":"Hello!"}}]}'
        yield 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":27,"completion_tokens":9}}'
        yield 'data: [DONE]'


class Http:
    def __init__(self, **kwargs):
        pass
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    async def post(self, *args, **kwargs):
        return Response()
    def stream(self, *args, **kwargs):
        return Response()


def test_model_reports_real_usage_and_content_ttft_without_recording_content(monkeypatch):
    monkeypatch.setattr('app.services.deepseek.httpx.AsyncClient', Http)
    async def run():
        model = DeepSeekClient(Settings(_env_file=None, deepseek_api_key='private-key'))
        with TraceContext('POST /api/chat/stream') as trace:
            chunks = [s async for s in model.chat_stream([{'role':'user','content':'private-prompt'}])]
        assert chunks == ['Hello!']
        return trace.record()
    record = asyncio.run(run())
    assert record['input_tokens'] == 27 and record['output_tokens'] == 9
    assert record['ttft_ms'] is not None and record['ttft_ms'] >= 0
    assert record['model'] == 'deepseek-flash'
    assert 'private-prompt' not in record['spans_json'] and 'private-key' not in record['spans_json']


def test_nonstream_model_usage_does_not_invent_first_token_time(monkeypatch):
    monkeypatch.setattr('app.services.deepseek.httpx.AsyncClient', Http)
    async def run():
        with TraceContext('score') as trace:
            assert await DeepSeekClient(Settings(_env_file=None, deepseek_api_key='key')).chat([]) == 'Hello!'
        return trace.record()
    record = asyncio.run(run())
    assert record['input_tokens'] == 27 and record['ttft_ms'] is None


def test_stream_error_after_http_200_is_not_counted_as_success():
    from app.db import SessionLocal
    from app.models.telemetry import AdminAccount
    class BrokenModel:
        async def chat_stream(self, *args, **kwargs):
            yield 'Hello '
            raise DeepSeekError('sensitive upstream URL')
    app.dependency_overrides[chat_api.get_client] = lambda: BrokenModel()
    try:
        with TestClient(app) as client:
            registered = client.post('/api/auth/register', json={'email':'stream-error-qa@example.com','password':'test-password'}).json()
            with SessionLocal() as db:
                db.add(AdminAccount(user_id=registered['user']['id'])); db.commit()
            response = client.post('/api/chat/stream', headers={'Accept':'text/event-stream'},
                json={'scenario_id':'cafe','messages':[{'role':'user','content':'I would like a coffee, please.'}]})
            assert response.status_code == 200 and 'event: error' in response.text
            detail = client.get('/api/admin/traces/' + response.headers['x-trace-id'], headers={'Authorization':'Bearer ' + registered['token']}).json()
            assert detail['outcome'] == 'error'
            assert 'sensitive upstream URL' not in json.dumps(detail)
    finally:
        app.dependency_overrides.pop(chat_api.get_client, None)


def test_stream_span_can_resume_and_close_in_a_different_asgi_task():
    from app.core.observability import traced_stream, trace_attribute
    @traced_stream('tts.synthesize', provider='xfyun')
    async def audio():
        trace_attribute('audio_bytes', 4)
        yield b'12'
        trace_attribute('audio_bytes', 8)
        yield b'34'
    async def run():
        with TraceContext('tts') as trace:
            stream = audio()
            assert await anext(stream) == b'12'
            async def remaining():
                return [chunk async for chunk in stream]
            assert await asyncio.create_task(remaining()) == [b'34']
        return json.loads(trace.record()['spans_json'])
    assert asyncio.run(run())[0]['attributes']['audio_bytes'] == 8
