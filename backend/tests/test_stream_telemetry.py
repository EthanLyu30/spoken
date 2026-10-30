import asyncio
import json
from types import SimpleNamespace

import pytest
from starlette.requests import ClientDisconnect
from starlette.responses import StreamingResponse

from app.core import observability as ob


@pytest.mark.parametrize('spec', ['2.3', '2.4'])
@pytest.mark.parametrize('primed', [False, True])
def test_disconnected_stream_is_cancelled_with_a_complete_span_snapshot(spec, primed):
    async def run():
        records, streams = [], []
        sent = asyncio.Event()
        name = 'tts.synthesize' if primed else 'deepseek.stream'
        @ob.traced_stream(name, provider='test')
        async def chunks():
            yield b'first'
            await asyncio.Event().wait()
        async def endpoint(scope, receive, send):
            stream = chunks(); streams.append(stream)
            if primed:
                first = await anext(stream)
                async def frames():
                    try:
                        yield first
                        async for chunk in stream:
                            yield chunk
                    finally:
                        await stream.aclose()
                response_stream = frames(); streams.append(response_stream)
            else:
                response_stream = stream
            await StreamingResponse(response_stream)(scope, receive, send)
        async def send(message):
            if message['type'] == 'http.response.body':
                sent.set()
                if spec == '2.4':
                    raise OSError('disconnected')
        async def receive():
            await sent.wait()
            return {'type': 'http.disconnect'}
        scope = {'type': 'http', 'path': '/api/tts/stream' if primed else '/api/chat/stream',
            'method': 'POST', 'headers': [], 'asgi': {'spec_version': spec},
            'app': SimpleNamespace(state=SimpleNamespace(telemetry_sink=SimpleNamespace(submit=records.append)))}
        try:
            try:
                await ob.TelemetryMiddleware(endpoint)(scope, receive, send)
            except ClientDisconnect:
                pass
            record = records[0]
            assert record['outcome'] == 'cancelled'
            child = json.loads(record['spans_json'])[0]
            assert child['outcome'] == 'cancelled'
            assert child['duration_ms'] > 0
            assert child['attributes']['provider'] == 'test'
            assert child['duration_ms'] <= record['duration_ms']
        finally:
            for stream in reversed(streams):
                await stream.aclose()
    asyncio.run(run())


def test_internal_cancelled_child_does_not_cancel_a_completed_request():
    async def run():
        records = []
        async def endpoint(scope, receive, send):
            try:
                with ob.span('optional.speculation'):
                    raise asyncio.CancelledError()
            except asyncio.CancelledError:
                pass
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'ok'})
        async def noop(*args):
            pass
        scope = {'type':'http','path':'/api/fixture','method':'GET','headers':[],
            'app':SimpleNamespace(state=SimpleNamespace(telemetry_sink=SimpleNamespace(submit=records.append)))}
        await ob.TelemetryMiddleware(endpoint)(scope, noop, noop)
        assert records[0]['outcome'] == 'ok'
        assert json.loads(records[0]['spans_json'])[0]['outcome'] == 'cancelled'
    asyncio.run(run())


def test_root_duration_stops_at_the_successfully_sent_final_body(monkeypatch):
    clock = SimpleNamespace(now=1.0)
    monkeypatch.setattr(ob, 'perf_counter', lambda: clock.now)
    async def run():
        records = []
        async def endpoint(scope, receive, send):
            await send({'type':'http.response.start','status':200,'headers':[]})
            clock.now = 2.0
            await send({'type':'http.response.body','body':b'ok'})
            clock.now = 100.0  # post-response cleanup is not user response latency
        async def noop(*args):
            pass
        scope = {'type':'http','path':'/api/fixture','method':'GET','headers':[],
            'app':SimpleNamespace(state=SimpleNamespace(telemetry_sink=SimpleNamespace(submit=records.append)))}
        await ob.TelemetryMiddleware(endpoint)(scope, noop, noop)
        assert records[0]['duration_ms'] == 1000
    asyncio.run(run())
