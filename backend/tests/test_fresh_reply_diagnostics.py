import asyncio
import json
import pytest
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.core.observability import TraceContext
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.main import app
from app.api import chat as chat_api

class Response:
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def raise_for_status(self): pass
    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"one"}}]}'
        await asyncio.sleep(.01)
        yield 'data: {"choices":[{"delta":{"content":"two"}}]}'
        await asyncio.sleep(.01)
        yield 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":3,"prompt_cache_hit_tokens":12,"prompt_cache_miss_tokens":8,"secret":"private"}}'
        yield 'data: [DONE]'
class Http:
    def __init__(self): self.payload = None
    def stream(self, *args, **kwargs):
        self.payload = kwargs['json']
        return Response()

def test_stream_timings_last_delta_once_and_bounded_cache_usage():
    async def run():
        http = Http()
        with TraceContext('test') as trace:
            assert [x async for x in DeepSeekClient(Settings(_env_file=None, deepseek_api_key='key'), http_client=http).chat_stream([])] == ['one', 'two']
        return trace, http.payload
    trace, payload = asyncio.run(run())
    p = trace.performance
    assert p['llm_first_text'] < p['llm_last_text'] < p['llm_done']
    assert p['llm_tail'] > 0
    assert p['llm_last_text'] < p['llm_done']
    assert p['llm_prompt_cache_hit_tokens'] == 12 and p['llm_prompt_cache_miss_tokens'] == 8
    assert 'stream_options' not in payload
    assert 'private' not in trace.record()['spans_json']

@pytest.mark.parametrize('reason', ['length', 'content_filter'])
def test_stream_rejects_explicit_unsuccessful_finish(reason):
    class Bad(Response):
        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"partial"}}]}'
            yield 'data: ' + json.dumps({'choices':[{'delta':{}, 'finish_reason':reason}]})
            yield 'data: [DONE]'
    class BadHttp(Http):
        def stream(self, *args, **kwargs): return Bad()
    async def run():
        return [x async for x in DeepSeekClient(Settings(_env_file=None, deepseek_api_key='key'), http_client=BadHttp()).chat_stream([])]
    with pytest.raises(DeepSeekError): asyncio.run(run())

class Sink:
    def __init__(self): self.records = []
    def submit(self, value): self.records.append(value)

def test_native_fields_are_strict_bounded_and_persisted():
    sink = Sink(); app.state.telemetry_sink = sink
    try:
        client = TestClient(app)
        body = {'operation':'speech.native_start', 'duration_ms':1, 'reason':'speech_error', 'error_code':'network', 'state_before':7, 'state_after':0, 'voice_type':'remote', 'voice_matched':False}
        assert client.post('/api/telemetry/client', json=body).status_code == 202
        attrs = json.loads(sink.records[-1]['spans_json'])[0]['attributes']
        assert all(attrs[k] == body[k] for k in ('reason','error_code','state_before','state_after','voice_type','voice_matched'))
        for changes in ({'state_before': True}, {'state_after': 8}, {'reason':'private'}, {'voice_matched':1}, {'voice_name':'private'}, {'operation':'speech.play_start'}):
            assert client.post('/api/telemetry/client', json={**body, **changes}).status_code == 422
        assert client.post('/api/telemetry/client', json={'operation':'speech.native_start', 'duration_ms':1}).status_code == 202
        for op in ('chat.first_text','chat.complete','chat.tail','speech.request_to_audio'):
            assert client.post('/api/telemetry/client', json={'operation':op,'duration_ms':1}).status_code == 202
    finally:
        del app.state.telemetry_sink

def test_done_frame_contains_only_safe_llm_numeric_timings():
    from app.core.performance import add
    class Model:
        async def chat_stream(self, *args, **kwargs):
            add('llm_first_text', 3); add('llm_last_text', 5); add('llm_done', 7); add('llm_tail', 2)
            add('db_query', 99)
            yield 'Hi'
    app.dependency_overrides[chat_api.get_client] = lambda: Model()
    try:
        with TestClient(app) as client:
            response = client.post('/api/chat/stream', headers={'Accept':'text/event-stream'}, json={'scenario_id':'cafe','messages':[{'role':'user','content':'Hello'}]})
            frames = response.text.split('\n\n')
            done = next(f for f in frames if f.startswith('event: done'))
            data = json.loads(done.split('data: ',1)[1])
            assert data['timings'] == {'llm_first_text':3, 'llm_last_text':5, 'llm_done':7, 'llm_tail':2}
    finally:
        app.dependency_overrides.pop(chat_api.get_client, None)


def test_invalid_cache_usage_is_not_recorded():
    class Invalid(Response):
        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_cache_hit_tokens":true,"prompt_cache_miss_tokens":10000001}}'
            yield 'data: [DONE]'
    class InvalidHttp(Http):
        def stream(self, *args, **kwargs): return Invalid()
    async def run():
        with TraceContext('test') as trace:
            assert [x async for x in DeepSeekClient(Settings(_env_file=None, deepseek_api_key='key'), http_client=InvalidHttp()).chat_stream([])] == ['ok']
        return trace
    trace = asyncio.run(run())
    assert 'llm_prompt_cache_hit_tokens' not in trace.performance
    assert 'llm_prompt_cache_miss_tokens' not in trace.performance
    assert 'prompt_cache_hit_tokens' not in trace.record()['spans_json']
