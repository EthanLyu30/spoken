import json
import asyncio
import base64
import pytest

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api import asr as asr_api
from app.api.asr import get_asr_stream_factory
from app.core.config import get_settings
from app.main import app
from app.services.xf_asr import XfAsrStream, XfAsrError

client = TestClient(app)


class _Cfg:
    """Minimal settings stub: the endpoint only reads these three fields."""

    def __init__(self, configured: bool = True) -> None:
        self.xf_app_id = "app" if configured else ""
        self.xf_api_key = "key" if configured else ""
        self.xf_api_secret = "secret" if configured else ""


class _FakeStream:
    """Stand-in for XfAsrStream that never touches the network."""

    def __init__(self, settings, on_partial, *, language="en_us") -> None:
        self.on_partial = on_partial
        self.sent = 0
        self.opened = False
        self.aborted = False

    async def open(self) -> None:
        self.opened = True

    async def send(self, pcm: bytes) -> None:
        self.sent += 1
        await self.on_partial(f"word{self.sent}")

    async def finish(self) -> str:
        return "hello world"

    async def abort(self) -> None:
        self.aborted = True


def _use(configured: bool = True):
    app.dependency_overrides[get_settings] = lambda: _Cfg(configured)
    app.dependency_overrides[get_asr_stream_factory] = lambda: (
        lambda settings, on_partial, *, language="en_us": _FakeStream(
            settings, on_partial, language=language
        )
    )


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_handshake_ready():
    _use()
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_text(json.dumps({"type": "start", "language": "en_us"}))
        assert ws.receive_json() == {"type": "ready"}


def test_unconfigured_reports_error():
    _use(configured=False)
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_text(json.dumps({"type": "start"}))
        assert ws.receive_json() == {
            "type": "error",
            "message": "iFlytek credentials are not configured",
        }


def test_streams_partials_then_final():
    _use()
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_text(json.dumps({"type": "start"}))
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(b"\x00\x01" * 640)
        assert ws.receive_json() == {"type": "partial", "text": "word1"}
        ws.send_bytes(b"\x02\x03" * 640)
        assert ws.receive_json() == {"type": "partial", "text": "word2"}
        ws.send_text(json.dumps({"type": "end"}))
        assert ws.receive_json() == {"type": "final", "text": "hello world"}


def test_multiple_utterances_one_connection():
    _use()
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_text(json.dumps({"type": "start"}))
        assert ws.receive_json()["type"] == "ready"
        for _ in range(2):
            ws.send_bytes(b"\x00\x01" * 640)
            assert ws.receive_json()["type"] == "partial"
            ws.send_text(json.dumps({"type": "end"}))
            assert ws.receive_json() == {"type": "final", "text": "hello world"}


def test_end_without_audio_returns_empty_final():
    _use()
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_text(json.dumps({"type": "start"}))
        assert ws.receive_json()["type"] == "ready"
        ws.send_text(json.dumps({"type": "end"}))
        assert ws.receive_json() == {"type": "final", "text": ""}


class _DirectSocket:
    def __init__(self, *messages):
        self.messages = asyncio.Queue()
        for message in messages:
            self.messages.put_nowait(message)
        self.sent = []
        self.closed = False

    async def accept(self):
        pass

    async def receive(self):
        return await self.messages.get()

    async def receive_text(self):
        message = await self.receive()
        if message.get("type") == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))
        return message.get("text", "")

    async def send_json(self, message):
        self.sent.append(message)

    async def close(self):
        self.closed = True


def _start_message():
    return {"type": "websocket.receive", "text": json.dumps({"type": "start"})}


def _audio_message(payload=b"\x00\x01"):
    return {"type": "websocket.receive", "bytes": payload}


def _control_message(payload):
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return {"type": "websocket.receive", "text": text}


def _direct_factory(settings, on_partial, *, language="en_us"):
    return _FakeStream(settings, on_partial, language=language)


def test_first_start_has_a_five_second_deadline(monkeypatch):
    monkeypatch.setattr(asr_api, "_START_TIMEOUT", 0.01)

    async def run():
        socket = _DirectSocket()
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert socket.sent[-1]["type"] == "error"
        assert socket.closed

    asyncio.run(run())


def test_connection_has_an_overall_deadline(monkeypatch):
    monkeypatch.setattr(asr_api, "_SESSION_TIMEOUT", 0.02)

    async def run():
        socket = _DirectSocket(_start_message())
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert socket.sent[0] == {"type": "ready"}
        assert socket.sent[-1]["type"] == "error"
        assert socket.closed

    asyncio.run(run())


@pytest.mark.parametrize("payload", [b"\x00", b"\x00" * 65538], ids=["odd-pcm", "oversized-frame"])
def test_audio_frame_hard_limits_close_with_an_explicit_error(payload):
    async def run():
        socket = _DirectSocket(_start_message(), _audio_message(payload))
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert socket.sent[0] == {"type": "ready"}
        assert socket.sent[-1]["type"] == "error"
        assert socket.closed

    asyncio.run(run())


def test_utterance_audio_limit_is_enforced_across_frames(monkeypatch):
    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 4)

    async def run():
        socket = _DirectSocket(
            _start_message(), _audio_message(b"\x00\x01"), _audio_message(b"\x00" * 4)
        )
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert socket.sent[-1]["type"] == "error"
        assert socket.closed
        assert not any(message["type"] == "final" for message in socket.sent)

    asyncio.run(run())


def test_exact_frame_limit_is_allowed_and_audio_budget_resets_each_turn(monkeypatch):
    monkeypatch.setattr(asr_api, "MAX_AUDIO_BYTES", 65536)

    async def run():
        socket = _DirectSocket(
            _start_message(),
            _audio_message(b"\x00" * 65536), _control_message({"type": "end"}),
            _audio_message(b"\x00" * 65536), _control_message({"type": "close"}),
        )
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert [message["type"] for message in socket.sent].count("final") == 1
        assert not any(message["type"] == "error" for message in socket.sent)
        assert socket.closed

    asyncio.run(run())


@pytest.mark.parametrize("control", ["{broken", {"type": "unknown"}, "null"])
def test_malformed_control_closes_instead_of_leaking_into_the_next_turn(control):
    async def run():
        socket = _DirectSocket(
            _start_message(), _control_message(control), _audio_message(), _control_message({"type": "end"})
        )
        await asyncio.wait_for(asr_api.asr_stream(socket, _Cfg(), _direct_factory), 0.3)
        assert socket.sent[-1]["type"] == "error"
        assert socket.closed
        assert not any(message["type"] in {"partial", "final"} for message in socket.sent)

    asyncio.run(run())


def test_provider_failure_closes_the_relay_instead_of_accepting_only_the_audio_tail():
    _use()
    attempts = []

    class FailedStream(_FakeStream):
        async def open(self):
            raise XfAsrError("opening timed out")

    def make(settings, on_partial, *, language="en_us"):
        attempts.append(True)
        cls = FailedStream if len(attempts) == 1 else _FakeStream
        return cls(settings, on_partial, language=language)

    app.dependency_overrides[get_asr_stream_factory] = lambda: make
    with client.websocket_connect("/api/asr/stream") as ws:
        ws.send_json({"type": "start"})
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(bytes(1280))
        assert ws.receive_json() == {"type": "error", "message": "opening timed out"}
        ws.send_bytes(bytes(1280))
        ws.send_json({"type": "end"})
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
    assert len(attempts) == 1


# --- wpgs dynamic-correction assembly (pure logic, no network) ---


async def _noop_partial(_text: str) -> None:
    pass


def _result(sn: int, text: str, pgs: str = "apd", rg=None) -> dict:
    r: dict = {"sn": sn, "pgs": pgs, "ws": [{"cw": [{"w": text}]}]}
    if rg is not None:
        r["rg"] = rg
    return r


def test_wpgs_append_then_replace():
    st = XfAsrStream(None, _noop_partial)
    st._apply(_result(1, "I "))
    assert st._current_text() == "I"
    st._apply(_result(2, "scream"))
    assert st._current_text() == "I scream"
    # iFlytek revises segment 2 in place.
    st._apply(_result(2, "like coffee", pgs="rpl", rg=[2, 2]))
    assert st._current_text() == "I like coffee"
    # Append, then collapse the whole 1..3 range into one corrected segment.
    st._apply(_result(3, " now"))
    assert st._current_text() == "I like coffee now"
    st._apply(_result(3, "Tea please", pgs="rpl", rg=[1, 3]))
    assert st._current_text() == "Tea please"


def test_wpgs_missing_sn_falls_back_to_order():
    st = XfAsrStream(None, _noop_partial)
    st._apply({"pgs": "apd", "ws": [{"cw": [{"w": "one "}]}]})
    st._apply({"pgs": "apd", "ws": [{"cw": [{"w": "two"}]}]})
    assert st._current_text() == "one two"


def test_small_capture_blocks_form_complete_asr_frames_and_flush_the_tail():
    frames = []
    class Socket:
        async def send(self, frame):
            frames.append(json.loads(frame))
        async def close(self):
            pass
    async def run():
        stream = XfAsrStream(_Cfg(), _noop_partial)
        stream._ws = Socket()
        await stream.send(b"\x01\x02" * 320)  # one 20 ms capture block
        assert frames == []
        await stream.send(b"\x03\x04" * 320)
        assert base64.b64decode(frames[0]["data"]["audio"]) == b"\x01\x02" * 320 + b"\x03\x04" * 320
        await stream.send(b"\x05\x06" * 320)
        stream._done.set()
        await stream.finish()
        assert base64.b64decode(frames[1]["data"]["audio"]) == b"\x05\x06" * 320 + b"\x00" * 640
        assert frames[-1]["data"]["status"] == 2
    asyncio.run(run())
