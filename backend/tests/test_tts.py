import array

from fastapi.testclient import TestClient

from app.api.tts import get_tts_client
from app.main import app
from app.services.xf_tts import SAMPLE_RATE, XfTtsError, smooth_silences

client = TestClient(app)


class _StubTts:
    def __init__(self, audio: bytes = b"\x00\x00\x01\x00\x02\x00\x03\x00") -> None:
        self.audio = audio  # raw 16-bit PCM bytes
        self.vcn: str | None = None
        self.aue: str | None = None
        self.speed: int | None = None
        self.pitch: int | None = None

    async def synthesize(self, text, *, vcn=None, aue="raw", speed=None, pitch=None, **_kwargs):
        self.vcn = vcn
        self.aue = aue
        self.speed = speed
        self.pitch = pitch
        return self.audio


def test_tts_returns_wav_audio():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post("/api/tts", json={"text": "Hello there"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/wav"
        # PCM is wrapped in a single WAV container for gapless playback.
        assert resp.content[:4] == b"RIFF"
        assert resp.content[8:12] == b"WAVE"
        assert stub.aue == "raw"
    finally:
        app.dependency_overrides.clear()


def test_tts_uses_scenario_voice():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post("/api/tts", json={"text": "hi", "scenario_id": "interview"})
        assert resp.status_code == 200
        assert stub.vcn == "henry"
    finally:
        app.dependency_overrides.clear()


def test_tts_applies_user_overrides():
    stub = _StubTts()
    app.dependency_overrides[get_tts_client] = lambda: stub
    try:
        resp = client.post(
            "/api/tts",
            json={"text": "hi", "scenario_id": "interview", "vcn": "x3_enus_emma_assist", "speed": 40, "pitch": 60},
        )
        assert resp.status_code == 200
        assert stub.vcn == "x3_enus_emma_assist"  # override beats scenario "henry"
        assert stub.speed == 40
        assert stub.pitch == 60
    finally:
        app.dependency_overrides.clear()


def test_tts_service_error_maps_to_503():
    class _Boom:
        async def synthesize(self, text, **_kwargs):
            raise XfTtsError("not configured")

    app.dependency_overrides[get_tts_client] = lambda: _Boom()
    try:
        resp = client.post("/api/tts", json={"text": "Hello"})
        assert resp.status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_tts_rejects_empty_text():
    assert client.post("/api/tts", json={"text": ""}).status_code == 422


def test_smooth_silences_shortens_internal_gap_and_trims_edges():
    rate = SAMPLE_RATE
    tone = array.array("h", [8000 if (i // 80) % 2 == 0 else -8000 for i in range(rate // 5)])  # 200ms
    long_sil = array.array("h", [0] * (rate // 2))  # 500ms internal silence
    edge_sil = array.array("h", [0] * (rate // 4))  # 250ms leading + trailing
    pcm = (edge_sil + tone + long_sil + tone + edge_sil).tobytes()
    out = smooth_silences(pcm)
    # Internal gap collapsed and leading/trailing silence removed.
    assert len(out) < len(pcm)
    # Both spoken segments survive.
    assert len(out) > len(tone.tobytes())


def test_smooth_silences_keeps_continuous_speech():
    rate = SAMPLE_RATE
    tone = array.array("h", [6000 if (i // 80) % 2 == 0 else -6000 for i in range(rate)])  # 1s buzz
    pcm = tone.tobytes()
    # No long internal silence -> essentially unchanged.
    assert smooth_silences(pcm) == pcm
