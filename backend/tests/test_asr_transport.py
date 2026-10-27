"""ASR transport regressions; provider I/O is the only replaced boundary."""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.services import xf_asr


SETTINGS = SimpleNamespace(xf_app_id="test", xf_api_key="test", xf_api_secret="test")


class Socket:
    def __init__(self, *, close_delay=0, respond=True):
        self.frames = []
        self.incoming = asyncio.Queue()
        self.close_delay = close_delay
        self.respond = respond
        self.closed = False

    async def send(self, raw):
        frame = json.loads(raw)
        self.frames.append(frame)
        if frame["data"]["status"] == 2 and self.respond:
            await self.incoming.put(json.dumps({
                "code": 0,
                "data": {"status": 2, "result": {
                    "sn": 0, "ls": True, "ws": [{"cw": [{"w": "coffee please"}]}],
                }},
            }))

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.incoming.get()

    async def close(self):
        await asyncio.sleep(self.close_delay)
        self.closed = True


class Dial:
    """Match websockets.connect's awaitable and context-manager interfaces."""

    def __init__(self, socket, error=None):
        self.socket = socket
        self.error = error

    async def connect(self):
        if self.error is not None:
            raise self.error
        return self.socket

    def __await__(self):
        return self.connect().__await__()

    async def __aenter__(self):
        return await self

    async def __aexit__(self, *_args):
        await self.socket.close()


async def noop(_text):
    pass


def test_final_text_does_not_wait_seconds_for_the_provider_close_handshake(monkeypatch):
    sockets = []

    def connect(_uri, **options):
        socket = Socket(close_delay=options.get("close_timeout", 10))
        sockets.append(socket)
        return Dial(socket)

    monkeypatch.setattr(xf_asr.websockets, "connect", connect)

    async def run():
        stream = xf_asr.XfAsrStream(SETTINGS, noop)
        await stream.open()
        await stream.send(b"\x01\x02" * 640)
        try:
            assert await asyncio.wait_for(stream.finish(), 1) == "coffee please"
            assert sockets[0].closed
        finally:
            await stream.abort()

    asyncio.run(run())


@pytest.mark.parametrize("streaming", [False, True])
def test_a_transient_opening_timeout_is_retried_before_failing_the_turn(monkeypatch, streaming):
    attempts = []
    socket = Socket()

    def connect(_uri, **options):
        attempts.append(options)
        return Dial(socket, TimeoutError() if len(attempts) == 1 else None)

    monkeypatch.setattr(xf_asr.websockets, "connect", connect)

    async def run():
        if streaming:
            stream = xf_asr.XfAsrStream(SETTINGS, noop)
            await stream.open()
            await stream.send(b"\x01\x02" * 1280)
            assert await stream.finish() == "coffee please"
        else:
            assert await xf_asr.XfAsrClient(SETTINGS).transcribe(b"\x01\x02" * 1280) == "coffee please"
        assert len(attempts) == 2
        assert all(0 < options["open_timeout"] < 5 for options in attempts)

    asyncio.run(run())


@pytest.mark.parametrize("byte_count", [320, 1280, 2560, 2900])
def test_buffered_audio_always_ends_once_even_for_a_single_short_frame(monkeypatch, byte_count):
    socket = Socket()
    monkeypatch.setattr(xf_asr.websockets, "connect", lambda *_args, **_kwargs: Dial(socket))

    async def run():
        result = await asyncio.wait_for(xf_asr.XfAsrClient(SETTINGS).transcribe(bytes(byte_count)), 0.5)
        assert result == "coffee please"
        statuses = [f["data"]["status"] for f in socket.frames]
        assert statuses[0] == 0
        assert statuses[-1] == 2
        assert statuses.count(2) == 1

    asyncio.run(run())


@pytest.mark.parametrize("language,expected_dwa", [("en_us", None), ("zh_cn", "wpgs")])
def test_stream_only_enables_dynamic_correction_for_supported_chinese(monkeypatch, language, expected_dwa):
    socket = Socket()
    monkeypatch.setattr(xf_asr.websockets, "connect", lambda *_args, **_kwargs: Dial(socket))

    async def run():
        stream = xf_asr.XfAsrStream(SETTINGS, noop, language=language)
        await stream.open()
        await stream.send(bytes(1280))
        assert socket.frames[0]["business"].get("dwa") == expected_dwa
        await stream.finish()

    asyncio.run(run())


def test_transcription_cannot_hang_forever_when_the_provider_never_finishes(monkeypatch):
    socket = Socket(respond=False)
    monkeypatch.setattr(xf_asr.websockets, "connect", lambda *_args, **_kwargs: Dial(socket))
    monkeypatch.setattr(xf_asr, "_TRANSCRIBE_TIMEOUT", 0.03, raising=False)

    async def run():
        with pytest.raises(xf_asr.XfAsrError):
            await asyncio.wait_for(xf_asr.XfAsrClient(SETTINGS).transcribe(bytes(2560)), 0.3)
        assert socket.closed

    asyncio.run(run())


def test_empty_final_frame_keeps_the_previously_recognised_text(monkeypatch):
    socket = Socket(respond=False)
    monkeypatch.setattr(xf_asr.websockets, "connect", lambda *_args, **_kwargs: Dial(socket))

    async def run():
        stream = xf_asr.XfAsrStream(SETTINGS, noop)
        await stream.open()
        await stream.send(bytes(1280))
        for payload in [
            {"code": 0, "data": {"status": 1, "result": {"sn": 1, "ws": [{"cw": [{"w": "coffee please"}]}]}}},
            {"code": 0, "data": {"status": 2}},
        ]:
            await socket.incoming.put(json.dumps(payload))
        assert await stream.finish() == "coffee please"

    asyncio.run(run())


def test_cancelling_an_open_does_not_start_a_retry(monkeypatch):
    attempts = []

    def connect(_uri, **_options):
        attempts.append(True)
        return Dial(Socket(), asyncio.CancelledError())

    monkeypatch.setattr(xf_asr.websockets, "connect", connect)

    async def run():
        with pytest.raises(asyncio.CancelledError):
            await xf_asr.XfAsrStream(SETTINGS, noop).open()
        assert len(attempts) == 1

    asyncio.run(run())


def test_exhausted_opening_retries_stop_without_submitting_audio(monkeypatch):
    attempts = []
    socket = Socket()

    def connect(_uri, **_options):
        attempts.append(True)
        return Dial(socket, TimeoutError())

    monkeypatch.setattr(xf_asr.websockets, "connect", connect)

    async def run():
        with pytest.raises(xf_asr.XfAsrError):
            await asyncio.wait_for(xf_asr.XfAsrClient(SETTINGS).transcribe(bytes(1280)), 0.3)
        assert len(attempts) == 2
        assert socket.frames == []

    asyncio.run(run())


def test_provider_rejection_is_not_retried_as_a_transient_dial_failure(monkeypatch):
    attempts = []
    socket = Socket(respond=False)

    def connect(_uri, **_options):
        attempts.append(True)
        return Dial(socket)

    monkeypatch.setattr(xf_asr.websockets, "connect", connect)

    async def run():
        await socket.incoming.put(json.dumps({"code": 10005, "message": "authorization rejected"}))
        with pytest.raises(xf_asr.XfAsrError, match="10005"):
            await xf_asr.XfAsrClient(SETTINGS).transcribe(bytes(1280))
        assert len(attempts) == 1
        assert socket.closed

    asyncio.run(run())
