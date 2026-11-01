import asyncio
import base64
import io
import json
import wave
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.observability import TraceContext

def TtsWarmupPool(**kwargs):
    from app.services.tts_warmup import TtsWarmupPool as Pool
    return Pool(**kwargs)


class Connection:
    def __init__(self, gate=None, error=None):
        self.gate = gate
        self.error = error
        self.entered = asyncio.Event()
        self.exits = 0
        self.sent = []
        self.state = SimpleNamespace(name="OPEN")

    async def __aenter__(self):
        if self.gate:
            await self.gate.wait()
        if self.error:
            raise self.error
        self.entered.set()
        return self

    async def __aexit__(self, *args):
        self.exits += 1
        self.state.name = "CLOSED"

    async def send(self, data):
        self.sent.append(json.loads(data))

    def __aiter__(self):
        return self.frames()

    async def frames(self):
        for pcm, status in [(b"\x01\x00", 1), (b"\x02\x00", 2)]:
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(pcm).decode(), "status": status}})


def test_ready_connection_is_consumed_once_and_closed_by_its_synthesis_owner():
    async def run():
        pool = TtsWarmupPool()
        connection = Connection()
        ticket = pool.reserve(lambda: connection)
        assert len(ticket) == 32
        await connection.entered.wait()
        prepared = pool.take(ticket)
        assert prepared is not None
        assert pool.take(ticket) is None
        async with prepared as socket:
            assert socket is connection
            await pool.close()  # In-use connection belongs to the active request.
            assert connection.exits == 0
        assert connection.exits == 1
    asyncio.run(run())


def test_pending_connection_is_discarded_without_waiting_for_its_handshake():
    async def run():
        pool = TtsWarmupPool()
        gate = asyncio.Event()
        connection = Connection(gate)
        ticket = pool.reserve(lambda: connection)
        await asyncio.sleep(0)
        assert pool.take(ticket) is None
        gate.set()
        await pool.close()
        assert pool.take(ticket) is None
        assert not connection.entered.is_set() or connection.exits == 1
    asyncio.run(run())


@pytest.mark.parametrize("reason", ["expired", "closed", "failed", "unknown"])
def test_unusable_connection_falls_back_and_releases_owned_resources(reason):
    async def run():
        now = [0.0]
        pool = TtsWarmupPool(clock=lambda: now[0])
        connection = Connection(error=RuntimeError("private provider URL") if reason == "failed" else None)
        ticket = pool.reserve(lambda: connection)
        await asyncio.sleep(0)
        if reason == "expired":
            now[0] = 4.0
        if reason == "closed":
            connection.state.name = "CLOSED"
        assert pool.take("0" * 32 if reason == "unknown" else ticket) is None
        await pool.close()
        assert connection.exits == (0 if reason == "failed" else 1)
    asyncio.run(run())


@pytest.mark.parametrize("when", ["connecting", "ready"])
def test_expiry_and_shutdown_release_preparations_in_both_states(when):
    async def run():
        pool = TtsWarmupPool(ttl=0.01)
        connection = Connection(asyncio.Event() if when == "connecting" else None)
        ticket = pool.reserve(lambda: connection)
        if when == "ready":
            await connection.entered.wait()
        await asyncio.sleep(0.02)
        assert pool.take(ticket) is None
        await pool.close()
        assert not connection.entered.is_set() or connection.exits == 1
        assert pool.reserve(lambda: Connection()) is None
    asyncio.run(run())


def test_shutdown_cancels_a_pending_handshake_and_closes_a_ready_socket():
    async def run():
        pool = TtsWarmupPool()
        pending = Connection(asyncio.Event())
        ready = Connection()
        pool.reserve(lambda: pending)
        pool.reserve(lambda: ready)
        await ready.entered.wait()
        await pool.close()
        assert ready.exits == 1
        assert not pending.entered.is_set()
    asyncio.run(run())


def test_cancel_after_transfer_closes_the_socket_once():
    async def run():
        pool = TtsWarmupPool()
        connection = Connection()
        ticket = pool.reserve(lambda: connection)
        await connection.entered.wait()
        prepared = pool.take(ticket)
        in_request = asyncio.Event()
        async def request():
            async with prepared:
                in_request.set()
                await asyncio.Event().wait()
        task = asyncio.create_task(request())
        await in_request.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await pool.close()
        assert connection.exits == 1
    asyncio.run(run())


def test_capacity_and_start_rate_reject_before_invoking_connection_factory():
    async def run():
        now = [0.0]
        pool = TtsWarmupPool(clock=lambda: now[0])
        created = []
        def factory():
            connection = Connection()
            created.append(connection)
            return connection
        tickets = [pool.reserve(factory) for _ in range(4)]
        assert all(tickets)
        assert pool.reserve(factory) is None
        assert len(created) == 4
        for connection, ticket in zip(created, tickets):
            await connection.entered.wait()
            async with pool.take(ticket):
                pass
        assert pool.reserve(factory) is None  # Capacity free, rate still exhausted.
        assert len(created) == 4
        now[0] = 1.01
        assert pool.reserve(factory) is not None
        await pool.close()
    asyncio.run(run())


def test_background_handshake_does_not_mutate_a_finished_prepare_trace():
    async def run():
        pool = TtsWarmupPool()
        gate = asyncio.Event()
        class TracedConnection(Connection):
            async def __aenter__(self):
                from app.core.performance import add
                await gate.wait()
                add("tts_connect", 99)
                return await super().__aenter__()
        connection = TracedConnection()
        with TraceContext("POST /api/tts/prepare") as prepare_trace:
            ticket = pool.reserve(lambda: connection)
        before = prepare_trace.record()["spans_json"]
        gate.set()
        await connection.entered.wait()
        assert prepare_trace.record()["spans_json"] == before
        with TraceContext("POST /api/tts") as tts_trace:
            async with pool.take(ticket):
                pass
        values = tts_trace.record()["spans_json"]
        assert '"tts_warmup_hit": 1' in values
        assert '"tts_warmup_connect"' in values
        assert '"tts_connect"' not in values
        await pool.close()
    asyncio.run(run())


def test_prepare_then_original_tts_uses_one_connection_and_exact_pcm(monkeypatch):
    from app.main import app
    from app.api.tts import get_tts_client
    from app.services import xf_tts
    connections = []
    def connect(*args, **kwargs):
        connection = Connection()
        connections.append(connection)
        return connection
    monkeypatch.setattr(xf_tts.websockets, "connect", connect)
    settings = Settings(_env_file=None, xf_app_id="test", xf_api_key="test", xf_api_secret="test")
    app.dependency_overrides[get_tts_client] = lambda: xf_tts.XfTtsClient(settings)
    try:
        with TestClient(app) as api:
            preparation = api.post("/api/tts/prepare")
            assert preparation.status_code == 200
            assert preparation.headers["cache-control"] == "no-store"
            result = api.post("/api/tts", json={"text": "Complete reply.", "vcn": "henry", "speed": 42, "pitch": 61, "warmup_ticket": preparation.json()["ticket"]})
            assert result.status_code == 200
            with wave.open(io.BytesIO(result.content), "rb") as wav:
                assert wav.readframes(wav.getnframes()) == b"\x01\x00\x02\x00"
            assert len(connections) == 1
            assert connections[0].sent[0]["business"]["vcn"] == "henry"
            assert connections[0].sent[0]["business"]["speed"] == 42
            assert connections[0].sent[0]["business"]["pitch"] == 61
            assert len(connections[0].sent) == 1
            assert connections[0].exits == 1
            assert "tts_warmup_hit" in result.headers["server-timing"]
    finally:
        app.dependency_overrides.clear()


def test_prepare_sanitizes_configuration_errors(monkeypatch):
    from app.main import app
    from app.api.tts import get_tts_client
    from app.services.xf_tts import XfTtsError
    class Broken:
        def connection(self):
            raise XfTtsError("wss://provider/?authorization=SECRET")
    app.dependency_overrides[get_tts_client] = Broken
    try:
        with TestClient(app) as api:
            result = api.post("/api/tts/prepare")
            assert result.status_code == 503
            assert result.headers["cache-control"] == "no-store"
            assert "SECRET" not in result.text
    finally:
        app.dependency_overrides.clear()


def test_unknown_ticket_and_legacy_requests_keep_the_original_tts_path(monkeypatch):
    from app.main import app
    from app.api.tts import get_tts_client
    from app.services import xf_tts
    connections = []
    def connect(*args, **kwargs):
        connection = Connection()
        connections.append(connection)
        return connection
    monkeypatch.setattr(xf_tts.websockets, "connect", connect)
    settings = Settings(_env_file=None, xf_app_id="test", xf_api_key="test", xf_api_secret="test")
    app.dependency_overrides[get_tts_client] = lambda: xf_tts.XfTtsClient(settings)
    try:
        with TestClient(app) as api:
            for extra in [{}, {"warmup_ticket": "f" * 32}]:
                result = api.post("/api/tts", json={"text": "Whole reply.", **extra})
                assert result.status_code == 200
            assert len(connections) == 2
            assert all(connection.exits == 1 and len(connection.sent) == 1 for connection in connections)
            assert api.post("/api/tts", json={"text": "Whole reply.", "warmup_ticket": "invalid"}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_public_audio_cache_hit_discards_a_ready_ticket_without_synthesis(monkeypatch):
    from app.main import app
    from app.api.tts import get_tts_client
    from app.services import xf_tts
    from app.services.public_tts_cache import public_key
    from app.data import scenarios
    connections = []
    def connect(*args, **kwargs):
        connection = Connection()
        connections.append(connection)
        return connection
    monkeypatch.setattr(xf_tts.websockets, "connect", connect)
    settings = Settings(_env_file=None, xf_app_id="test", xf_api_key="test", xf_api_secret="test")
    app.dependency_overrides[get_tts_client] = lambda: xf_tts.XfTtsClient(settings)
    try:
        with TestClient(app) as api:
            text = scenarios.get_scenario("cafe").opening_line
            cfg = scenarios.voice_for("cafe")
            key = public_key(text, "cafe", vcn=cfg["vcn"], speed=cfg["speed"], pitch=cfg["pitch"])
            assert key is not None
            cached = xf_tts.pcm16_to_wav(b"\x11\x00\x22\x00")
            app.state.public_tts_cache.put(key, cached)
            preparation = api.post("/api/tts/prepare")
            result = api.post("/api/tts", json={"text": text, "scenario_id": "cafe", **{"warmup_ticket": preparation.json()["ticket"]}})
            assert result.content == cached
            assert all(not connection.sent for connection in connections)
        assert len(connections) == 1 and connections[0].exits == 1
    finally:
        app.dependency_overrides.clear()


def test_synthesis_error_before_entering_prepared_socket_releases_it(monkeypatch):
    from app.main import app
    from app.api.tts import get_tts_client
    from app.services.xf_tts import XfTtsError
    connection = None
    class FailedSynthesis:
        def connection(self):
            nonlocal connection
            connection = Connection()
            return connection
        async def synthesize(self, text, **kwargs):
            raise XfTtsError("synthesis unavailable")
    app.dependency_overrides[get_tts_client] = FailedSynthesis
    try:
        with TestClient(app) as api:
            prep = api.post("/api/tts/prepare")
            result = api.post("/api/tts", json={"text": "Full text.", "warmup_ticket": prep.json()["ticket"]})
            assert result.status_code == 503
            assert connection.exits == 1
    finally:
        app.dependency_overrides.clear()
