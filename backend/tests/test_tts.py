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
