import json
import asyncio
import base64

from fastapi.testclient import TestClient

from app.api.asr import get_asr_stream_factory
from app.core.config import get_settings
from app.main import app
from app.services.xf_asr import XfAsrStream

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
