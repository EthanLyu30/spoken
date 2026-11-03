"""Bounded live upload overlaps capture, and provider failures stop upload."""
import asyncio
import base64
import json
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.pronunciation import get_ise_client, pronunciation_stream
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
                                  {'type': 'start', 'text': 'hi', 'language': 'invalid'},
                                  {'type': 'start', 'text': 'hi', 'entry': 'invalid'}])
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
            ws.send_json({'type': 'start', 'text': 'private learner reference', 'entry': 'follow_read'})
            assert ws.receive_json()['type'] == 'ready'
            ws.send_bytes(b'\0\1')
            ws.send_json({'type': 'end'})
            assert ws.receive_json()['type'] == 'result'
        assert len(records) == 1
        assert records[0]['operation'] == 'WS /api/pronunciation/stream'
        assert records[0]['outcome'] == 'ok'
        spans = json.loads(records[0]['spans_json'])
        request = next(span for span in spans if span['name'] == 'pronunciation.request')
        assert request['attributes']['entry'] == 'follow_read'
        assert 'private learner reference' not in json.dumps(records, default=str)
    finally:
        app.state.telemetry_sink = previous_sink
        app.dependency_overrides.clear()


class InboundSocket:
    """Direct ASGI-message socket; every receive has one observable owner."""

    def __init__(self, *messages):
        self.messages = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.active_receives = 0
        self.max_active_receives = 0
        self.receive_cancelled = asyncio.Event()
        self.feed({'type': 'websocket.receive', 'text': json.dumps({'type': 'start', 'text': 'hi'})}, *messages)

    def feed(self, *messages):
        for message in messages:
            self.messages.put_nowait(message)

    async def accept(self):
        pass

    async def receive_json(self):
        return json.loads((await self.receive())['text'])

    async def receive(self):
        self.active_receives += 1
        self.max_active_receives = max(self.max_active_receives, self.active_receives)
        assert self.active_receives == 1, 'WebSocket must have only one inbound reader'
        try:
            return await self.messages.get()
        except asyncio.CancelledError:
            self.receive_cancelled.set()
            raise
        finally:
            self.active_receives -= 1

    async def send_json(self, message):
        self.sent.append(message)

    async def close(self):
        self.closed = True


def pcm_message(size=1280):
    return {'type': 'websocket.receive', 'bytes': b'\0' * size}


def end_message():
    return {'type': 'websocket.receive', 'text': '{"type":"end"}'}


async def expect_finished(task, reason):
    done, _ = await asyncio.wait({task}, timeout=.3)
    assert task in done, reason
    await task


@pytest.mark.anyio
async def test_disconnect_after_end_cancels_provider_final_wait_promptly():
    waiting, released = asyncio.Event(), asyncio.Event()
    socket = InboundSocket(pcm_message(), end_message())

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            try:
                await on_ready()
                async for _ in audio:
                    pass
                waiting.set()
                await asyncio.Event().wait()
            finally:
                released.set()

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await asyncio.wait_for(waiting.wait(), .3)
        socket.feed({'type': 'websocket.disconnect', 'code': 1000})
        await expect_finished(route, 'disconnect after end must interrupt the provider final wait')
        assert released.is_set() and socket.closed
        assert socket.sent == [{'type': 'ready'}]
        assert socket.max_active_receives == 1
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
async def test_disconnect_behind_queued_pcm_cancels_blocked_upstream_promptly():
    blocked, released = asyncio.Event(), asyncio.Event()
    socket = InboundSocket(pcm_message())

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            try:
                await on_ready()
                async for _ in audio:
                    blocked.set()
                    await asyncio.Event().wait()
            finally:
                released.set()

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await asyncio.wait_for(blocked.wait(), .3)
        socket.feed(pcm_message(), pcm_message(), {'type': 'websocket.disconnect', 'code': 1000})
        await expect_finished(route, 'queued audio must not hide disconnect behind provider backpressure')
        assert released.is_set() and socket.closed and socket.active_receives == 0
        assert socket.sent == [{'type': 'ready'}]
        assert socket.max_active_receives == 1
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
@pytest.mark.parametrize('size,count', [(65536, 9), (2, 4097)], ids=['pending-bytes', 'pending-frames'])
async def test_pending_audio_overflow_reports_error_and_releases_provider(size, count):
    blocked, released = asyncio.Event(), asyncio.Event()
    socket = InboundSocket()

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            try:
                await on_ready()
                blocked.set()
                await asyncio.Event().wait()
            finally:
                released.set()

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await asyncio.wait_for(blocked.wait(), .3)
        socket.feed(*(pcm_message(size) for _ in range(count)))
        await expect_finished(route, 'bounded queue overflow must fail without blocking the inbound reader')
        assert released.is_set() and socket.closed and socket.active_receives == 0
        assert socket.sent[-1] == {'type': 'error', 'message': '语音评测未完成，请重试。'}
        assert not any(message['type'] == 'result' for message in socket.sent)
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
async def test_evaluator_failure_cancels_and_gathers_inbound_reader():
    socket = InboundSocket()

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            await on_ready()
            raise xf_ise.XfIseError('private provider diagnostics')

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await expect_finished(route, 'provider errors must release the waiting inbound reader')
        assert socket.receive_cancelled.is_set()
        assert socket.active_receives == 0 and socket.closed
        assert socket.sent[-1] == {'type': 'error', 'message': '语音评测未完成，请重试。'}
        assert 'private provider diagnostics' not in json.dumps(socket.sent)
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
async def test_pre_ready_burst_and_consumed_audio_fit_pending_budget():
    # The browser can flush 384 KiB as soon as it receives ready. A later burst
    # must have its own pending budget once the first burst has been consumed.
    socket = InboundSocket(*(pcm_message(65536) for _ in range(6)))
    consumed = []

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            await on_ready()
            async for chunk in audio:
                consumed.append(len(chunk))
                if len(consumed) == 6:
                    socket.feed(*(pcm_message(65536) for _ in range(6)), end_message())
            return SAMPLE_XML

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await expect_finished(route, 'legitimate pre-ready and later bursts must retain their PCM')
        assert consumed == [65536] * 12
        assert socket.sent[-1]['type'] == 'result'
        assert socket.active_receives == 0 and socket.closed
        assert socket.max_active_receives == 1
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
async def test_end_sentinel_fits_at_pending_frame_limit():
    socket = InboundSocket(*(pcm_message(2) for _ in range(4096)), end_message())
    received = []

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            await on_ready()
            async for chunk in audio:
                received.append(chunk)
            return SAMPLE_XML

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await expect_finished(route, 'end needs a reserved slot when the PCM frame budget is full')
        assert received == [b'\0\0'] * 4096
        assert socket.sent[-1]['type'] == 'result' and socket.active_receives == 0
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)


@pytest.mark.anyio
async def test_audio_after_end_rejects_input_and_cancels_final_wait():
    waiting, released = asyncio.Event(), asyncio.Event()
    socket = InboundSocket(pcm_message(), end_message())

    class Stub:
        async def evaluate_stream(self, text, audio, *, on_ready, **kwargs):
            try:
                await on_ready()
                async for _ in audio:
                    pass
                waiting.set()
                await asyncio.Event().wait()
            finally:
                released.set()

    route = asyncio.create_task(pronunciation_stream(socket, Stub()))
    try:
        await asyncio.wait_for(waiting.wait(), .3)
        socket.feed(pcm_message())
        await expect_finished(route, 'post-end input must fail without leaving the final wait alive')
        assert released.is_set() and socket.closed
        assert socket.sent[-1] == {'type': 'error', 'message': '语音评测未完成，请重试。'}
    finally:
        route.cancel()
        await asyncio.gather(route, return_exceptions=True)
