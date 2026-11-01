"""Bounded live upload overlaps capture, and provider failures stop upload."""
import asyncio
import base64
import json
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.pronunciation import get_ise_client
from app.core.config import Settings
from app.main import app
from app.services import xf_ise
from tests.test_pronunciation import SAMPLE_XML


@pytest.fixture
def anyio_backend():
    return 'asyncio'


class Socket:
    def __init__(self):
        self.sent = []
        self.messages = asyncio.Queue()
        self.closed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        self.closed = True

    async def send(self, message):
        frame = json.loads(message)
        self.sent.append(frame)
        if frame['data']['status'] == 2:
            await self.messages.put(json.dumps({'code': 0, 'data': {
                'status': 2, 'data': base64.b64encode(SAMPLE_XML.encode()).decode()}}))

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.messages.get()


def provider(monkeypatch, socket):
    monkeypatch.setattr(xf_ise.websockets, 'connect', lambda *_a, **_k: socket)
    return xf_ise.XfIseClient(Settings(xf_app_id='test', xf_api_key='test', xf_api_secret='test'))


@pytest.mark.anyio
async def test_live_pcm_reaches_provider_before_recording_ends(monkeypatch):
    socket = Socket()
    ise = provider(monkeypatch, socket)
    stop = asyncio.Event()
    ready = []

    async def audio():
        yield b'\0\1' * 640
        await stop.wait()
        yield b'\2\3' * 73

    async def on_ready():
        ready.append(True)

    result = asyncio.create_task(ise.evaluate_stream('hi there', audio(), on_ready=on_ready))
    try:
        for _ in range(100):
            if len(socket.sent) >= 2:
                break
            await asyncio.sleep(.002)
        assert ready == [True]
        assert len(socket.sent) >= 2, 'audio must upload during recording, not after stop'
        assert not result.done()
        stop.set()
        assert await asyncio.wait_for(result, 1) == SAMPLE_XML
        pcm = b''.join(base64.b64decode(m['data']['data']) for m in socket.sent[1:])
        assert pcm == b'\0\1' * 640 + b'\2\3' * 73
        assert socket.sent[-1]['business']['aus'] == 4
        assert socket.sent[-1]['data']['status'] == 2
        assert socket.closed
    finally:
        result.cancel()
        await asyncio.gather(result, return_exceptions=True)


@pytest.mark.anyio
async def test_provider_error_interrupts_still_recording_audio(monkeypatch):
    socket = Socket()
    ise = provider(monkeypatch, socket)

    async def audio():
        yield b'\0\1' * 640
        await asyncio.Event().wait()

    await socket.messages.put(json.dumps({'code': 10109, 'message': 'invalid text'}))
    with pytest.raises(xf_ise.XfIseError, match='10109'):
        await asyncio.wait_for(ise.evaluate_stream('hi', audio()), .5)
    assert socket.closed


@pytest.mark.anyio
async def test_silent_final_result_has_deadline_and_closes_provider(monkeypatch):
    socket = Socket()
    ise = provider(monkeypatch, socket)
    original_send = socket.send

    async def no_result(message):
        await original_send(message)
        while not socket.messages.empty():
            socket.messages.get_nowait()

    socket.send = no_result
    monkeypatch.setattr(xf_ise, '_FINAL_TIMEOUT', .025, raising=False)

    async def audio():
        yield b'\0\1' * 12

    with pytest.raises(xf_ise.XfIseError, match='timed out'):
        await asyncio.wait_for(ise.evaluate_stream('hi', audio()), .5)
    assert socket.closed


@pytest.mark.anyio
async def test_cancel_releases_provider_and_audio_iterator(monkeypatch):
    socket = Socket()
    ise = provider(monkeypatch, socket)
    released = asyncio.Event()

    async def audio():
        try:
            yield b'\0\1' * 640
            await asyncio.Event().wait()
        finally:
            released.set()

    result = asyncio.create_task(ise.evaluate_stream('hi', audio()))
    await asyncio.sleep(.03)
    result.cancel()
    with pytest.raises(asyncio.CancelledError):
        await result
    assert socket.closed and released.is_set()


def test_live_endpoint_reads_binary_until_end_and_matches_existing_result():
    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, language):
            assert text == 'hi there' and language == 'en'
            await on_ready()
            chunks = [c async for c in audio]
            assert chunks == [b'\0\1' * 640, b'\2\3']
            return SAMPLE_XML

    app.dependency_overrides[get_ise_client] = Stub
    try:
        with TestClient(app).websocket_connect('/api/pronunciation/stream') as ws:
            ws.send_json({'type': 'start', 'text': 'hi there', 'language': 'en'})
            assert ws.receive_json() == {'type': 'ready'}
            ws.send_bytes(b'\0\1' * 640)
            ws.send_bytes(b'\2\3')
            ws.send_json({'type': 'end'})
            result = ws.receive_json()
            assert result['type'] == 'result'
            assert result['result']['overall'] == 90
            assert len(result['result']['words']) == 2
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize('start', [{}, {'type': 'start', 'text': ''},
                                  {'type': 'start', 'text': 'x' * 2001},
                                  {'type': 'start', 'text': 'hi', 'language': 'invalid'}])
def test_live_endpoint_rejects_invalid_start_without_provider(start):
    with TestClient(app).websocket_connect('/api/pronunciation/stream') as ws:
        ws.send_json(start)
        assert ws.receive_json()['type'] == 'error'


@pytest.mark.parametrize('payload', [b'\0', b'\0\1' * 32769, '{"type":"invalid"}'],
                         ids=['odd-byte', 'oversized-frame', 'invalid-command'])
def test_live_endpoint_rejects_invalid_frames(payload):
    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            await on_ready()
            async for _ in audio:
                pass
            return SAMPLE_XML

    app.dependency_overrides[get_ise_client] = Stub
    try:
        with TestClient(app).websocket_connect('/api/pronunciation/stream') as ws:
            ws.send_json({'type': 'start', 'text': 'hi'})
            assert ws.receive_json()['type'] == 'ready'
            if isinstance(payload, bytes):
                ws.send_bytes(payload)
            else:
                ws.send_text(payload)
            assert ws.receive_json()['type'] == 'error'
    finally:
        app.dependency_overrides.clear()


def test_live_disconnect_releases_active_provider():
    released = threading.Event()

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            try:
                await on_ready()
                async for _ in audio:
                    pass
            finally:
                released.set()

    app.dependency_overrides[get_ise_client] = Stub
    try:
        with TestClient(app).websocket_connect('/api/pronunciation/stream') as ws:
            ws.send_json({'type': 'start', 'text': 'hi'})
            assert ws.receive_json()['type'] == 'ready'
        assert released.wait(1)
    finally:
        app.dependency_overrides.clear()


def test_streaming_assessments_still_appear_in_backend_telemetry():
    records = []
    previous_sink = getattr(app.state, 'telemetry_sink', None)
    app.state.telemetry_sink = SimpleNamespace(submit=records.append)

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            await on_ready()
            async for _ in audio:
                pass
            return SAMPLE_XML

    app.dependency_overrides[get_ise_client] = Stub
    try:
        with TestClient(app).websocket_connect('/api/pronunciation/stream') as ws:
            ws.send_json({'type': 'start', 'text': 'private learner reference'})
            assert ws.receive_json()['type'] == 'ready'
            ws.send_bytes(b'\0\1')
            ws.send_json({'type': 'end'})
            assert ws.receive_json()['type'] == 'result'
        assert len(records) == 1
        assert records[0]['operation'] == 'WS /api/pronunciation/stream'
        assert records[0]['outcome'] == 'ok'
        assert 'private learner reference' not in json.dumps(records, default=str)
    finally:
        app.state.telemetry_sink = previous_sink
        app.dependency_overrides.clear()
