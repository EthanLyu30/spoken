import asyncio
import io
import json
import wave
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.api.tts import get_tts_client
from app.core.observability import TraceContext
from app.data import scenarios
from app.main import app
from app.services.xf_tts import XfTtsError, pcm16_to_wav

PREVIEW = "Hi! I'm Pip. Let's practice English together — you've got this!"
OPENER = scenarios.get_scenario("cafe").opening_line
PCM = b"\x01\x00\x02\x00" * 40


class Synth:
    def __init__(self):
        self.calls = []
        self.failure = False
    async def synthesize(self, text, **kwargs):
        self.calls.append((text, kwargs))
        if self.failure:
            raise XfTtsError("unavailable")
        return PCM


@pytest.fixture
def public_client():
    synth = Synth()
    app.dependency_overrides[get_tts_client] = lambda: synth
    try:
        with TestClient(app) as client:
            yield client, synth
    finally:
        app.dependency_overrides.pop(get_tts_client, None)


@pytest.mark.parametrize("payload", [{"text": OPENER, "scenario_id": "cafe"}, {"text": PREVIEW}])
def test_only_complete_public_wav_is_reused_with_explicit_hit_counts(public_client, payload):
    client, synth = public_client
    cold = client.post("/api/tts", json=payload)
    hit = client.post("/api/tts", json=payload)
    assert cold.status_code == hit.status_code == 200
    assert cold.content == hit.content == pcm16_to_wav(PCM)
    assert len(synth.calls) == 1
    assert 'tts_cache_miss;desc="1"' in cold.headers["server-timing"]
    assert 'tts_cache_hit;desc="1"' in hit.headers["server-timing"]
    with wave.open(io.BytesIO(hit.content)) as wav:
        assert wav.readframes(wav.getnframes()) == PCM


@pytest.mark.parametrize("payload", [
    {"text": "My private generated reply", "scenario_id": "cafe"},
    {"text": "My interview answer", "scenario_id": "interview"},
    {"text": "dictionary"}, {"text": OPENER + " ", "scenario_id": "cafe"},
    {"text": OPENER, "scenario_id": "custom"}, {"text": OPENER},
    {"text": PREVIEW, "scenario_id": "custom"},
])
def test_private_custom_arbitrary_and_near_match_text_never_reused(public_client, payload):
    client, synth = public_client
    for _ in range(2):
        assert client.post("/api/tts", json=payload).status_code == 200
    assert len(synth.calls) == 2
    assert not app.state.public_tts_cache._entries


def test_normalized_legacy_voice_reuses_effective_key_and_prosody_changes_miss(public_client):
    client, synth = public_client
    for options in ({"vcn": "x4_lindsey_formal"}, {"vcn": "catherine"},
                    {"vcn": "henry"}, {"vcn": "catherine", "speed": 1},
                    {"vcn": "catherine", "pitch": 1}):
        assert client.post("/api/tts", json={"text": PREVIEW, **options}).status_code == 200
    assert len(synth.calls) == 4


def test_failed_synthesis_is_not_cached(public_client):
    client, synth = public_client
    synth.failure = True
    assert client.post("/api/tts", json={"text": PREVIEW}).status_code == 503
    synth.failure = False
    assert client.post("/api/tts", json={"text": PREVIEW}).status_code == 200
    assert client.post("/api/tts", json={"text": PREVIEW}).status_code == 200
    assert len(synth.calls) == 2


def test_cache_bounds_expiry_and_all_effective_key_fields():
    from app.services.public_tts_cache import PublicTtsCache, public_key
    now = [0.0]
    cache = PublicTtsCache(clock=lambda: now[0])
    key = public_key(PREVIEW, None, vcn="catherine", speed=54, pitch=52)
    assert key is not None
    wav = pcm16_to_wav(PCM)
    cache.put(key, wav)
    for field, value in {"vcn": "henry", "speed": 1, "pitch": 1, "volume": 1,
                         "format": "mp3", "sample_rate": 24000, "version": "next"}.items():
        assert cache.get(replace(key, **{field: value})) is None
    now[0] = 299.9
    assert cache.get(key) == wav
    now[0] = 300
    assert cache.get(key) is None  # Hits do not renew the TTL.
    for speed in range(17):
        cache.put(replace(key, speed=speed), wav)
    assert len(cache._entries) == 16
    assert cache.get(replace(key, speed=0)) is None
    cache.clear()
    large = pcm16_to_wav(b"\0\0" * 600_000)
    for speed in range(4):
        cache.put(replace(key, speed=speed), large)
    assert len(cache._entries) == 3
    assert cache.get(replace(key, speed=0)) is None
    assert cache._bytes <= 4 * 1024 * 1024
    cache.put(key, pcm16_to_wav(b"\0\0" * (2 * 1024 * 1024)))
    assert cache.get(key) is None


@pytest.mark.parametrize("audio", [b"partial", b"blob:object-url", pcm16_to_wav(b""), pcm16_to_wav(PCM)[:-2]])
def test_cache_rejects_incomplete_empty_or_non_wav_bytes(audio):
    from app.services.public_tts_cache import PublicTtsCache, public_key
    cache = PublicTtsCache()
    key = public_key(PREVIEW, None, vcn="catherine", speed=54, pitch=52)
    cache.put(key, audio)
    assert cache.get(key) is None


def test_cache_hit_has_no_provider_span_or_private_content():
    from fastapi import Request
    from app.api.tts import tts
    from app.schemas.tts import TtsRequest
    from app.services.public_tts_cache import PublicTtsCache
    app.state.public_tts_cache = PublicTtsCache()
    request = Request({"type": "http", "app": app})
    async def run():
        synth = Synth()
        req = TtsRequest(text=PREVIEW)
        await tts(req, request, synth)
        with TraceContext("POST /api/tts") as trace:
            await tts(req, request, synth)
        assert len(synth.calls) == 1
        record = trace.record()
        spans = json.loads(record["spans_json"])
        assert not any(span["attributes"].get("provider") for span in spans)
        assert PREVIEW not in record["spans_json"]
        assert any(span["name"] == "tts.public_cache" and span["attributes"].get("cache_hit") is True for span in spans)
    try:
        asyncio.run(run())
    finally:
        app.state.public_tts_cache = None


def test_pending_and_cancelled_synthesis_never_admits_a_partial_waveform():
    from fastapi import Request
    from app.api.tts import tts
    from app.schemas.tts import TtsRequest
    from app.services.public_tts_cache import PublicTtsCache
    app.state.public_tts_cache = PublicTtsCache()
    request = Request({"type": "http", "app": app})
    async def run():
        entered = asyncio.Event()
        class Pending:
            async def synthesize(self, *args, **kwargs):
                entered.set()
                await asyncio.Event().wait()
        pending = asyncio.create_task(tts(TtsRequest(text=PREVIEW), request, Pending()))
        await entered.wait()
        assert not app.state.public_tts_cache._entries
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert not app.state.public_tts_cache._entries
        synth = Synth()
        await tts(TtsRequest(text=PREVIEW), request, synth)
        assert len(synth.calls) == 1 and len(app.state.public_tts_cache._entries) == 1
    try:
        asyncio.run(run())
    finally:
        app.state.public_tts_cache = None


def test_lifespan_clears_public_waveforms():
    with TestClient(app):
        from app.services.public_tts_cache import public_key
        cache = app.state.public_tts_cache
        cache.put(public_key(PREVIEW, None, vcn="catherine", speed=54, pitch=52), pcm16_to_wav(PCM))
        assert cache._entries
    assert cache._entries == {} and cache._bytes == 0
    assert app.state.public_tts_cache is None
