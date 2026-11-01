import array
import asyncio
import base64
import json

import pytest

from app.services.xf_tts import SAMPLE_RATE, XfTtsClient, XfTtsError, smooth_silences


def test_all_scenario_defaults_use_verified_english_voices():
    from app.data import scenarios
    assert scenarios.DEFAULT_VOICE["vcn"] == "catherine"
    assert all(config["vcn"] in {"catherine", "henry"} for config in scenarios._VOICES.values())



def test_smooth_silences_collapses_only_near_zero_internal_gap():
    rate = SAMPLE_RATE
    tone = array.array("h", [8000, -8000] * (rate // 10))  # 200 ms
    zero_gap = array.array("h", [0] * (rate // 5))  # 200 ms
    pcm = (tone + zero_gap + tone).tobytes()
    out = smooth_silences(pcm)
    assert len(out) < len(pcm)
    assert len(out) >= len((tone + tone).tobytes()) + int(rate * 0.06) * 2



def test_smooth_silences_preserves_low_energy_speech():
    rate = SAMPLE_RATE
    low_energy = array.array("h", [120, -120] * (rate // 2))  # 1 second
    pcm = low_energy.tobytes()
    assert smooth_silences(pcm) == pcm



def test_smooth_silences_preserves_low_energy_speech_between_loud_segments():
    rate = SAMPLE_RATE
    tone = array.array("h", [5000, -5000] * (rate // 10))  # 200 ms
    low_energy = array.array("h", [120, -120] * (rate // 10))  # 200 ms
    pcm = (tone + low_energy + tone).tobytes()
    assert smooth_silences(pcm) == pcm



def test_smooth_silences_keeps_longer_sentence_pause():
    rate = SAMPLE_RATE
    tone = array.array("h", [5000, -5000] * (rate // 10))
    sentence_gap = array.array("h", [0] * (rate // 2))  # 500 ms
    out = smooth_silences((tone + sentence_gap + tone).tobytes())
    kept_samples = len(out) // 2 - len(tone) * 2
    assert kept_samples >= int(rate * 0.18)



def test_tts_service_yields_first_frame_before_upstream_finishes(monkeypatch):
    from app.core.config import Settings
    from app.services import xf_tts
    class Socket:
        finished = False
        async def send(self, data):
            pass
        def __aiter__(self):
            return self.frames()
        async def frames(self):
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x01\x00").decode(), "status": 1}})
            self.finished = True
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x02\x00").decode(), "status": 2}})
    socket = Socket()
    class Connection:
        async def __aenter__(self):
            return socket
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection())
    async def run():
        service = XfTtsClient(Settings(xf_app_id="test", xf_api_key="test", xf_api_secret="test"))
        stream = service.synthesize_stream("Hello")
        assert await anext(stream) == b"\x01\x00"
        assert not socket.finished
        assert await anext(stream) == b"\x02\x00"
        with pytest.raises(StopAsyncIteration):
            await anext(stream)
    asyncio.run(run())



def test_complete_synthesis_does_not_wait_for_a_slow_close_handshake(monkeypatch):
    from app.core.config import Settings
    from app.services import xf_tts
    pcm = b"\x01\x00\x02\x00"

    class Socket:
        async def send(self, data):
            pass

        def __aiter__(self):
            return self.frames()

        async def frames(self):
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(pcm[:2]).decode(), "status": 1}})
            await asyncio.sleep(0.2)  # More than the close budget: audio must still finish.
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(pcm[2:]).decode(), "status": 2}})

    class Connection:
        def __init__(self, close_timeout):
            self.close_timeout = close_timeout

        async def __aenter__(self):
            return Socket()

        async def __aexit__(self, *args):
            # Model a peer that has sent all audio but never promptly ACKs close.
            await asyncio.sleep(min(self.close_timeout, 1.5))

    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection(kwargs["close_timeout"]))

    async def run():
        service = XfTtsClient(Settings(xf_app_id="test", xf_api_key="test", xf_api_secret="test"))
        audio = await asyncio.wait_for(service.synthesize("One complete reply."), timeout=0.8)
        assert audio == pcm

    asyncio.run(run())
