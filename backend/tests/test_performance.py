"""Diagnostics regressions: synthetic SQLite and offline provider transports only."""
import asyncio
import base64
import json
import re
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text

from app.core.config import Settings
from app.core.observability import TraceContext
from app.db import SessionLocal
from app.main import app


def metrics(trace):
    nodes = json.loads(trace.record()["spans_json"])
    return next((n["attributes"] for n in nodes if n["name"] == "performance"), {})


def test_lazy_acquisition_covers_connect_and_records_queries_and_commit():
    # Removing session acquisition instrumentation loses the slow connect delay.
    engine = create_engine("sqlite://")
    @event.listens_for(engine, "connect")
    def delay(*args):
        time.sleep(0.02)
    with TraceContext("test") as trace, SessionLocal(bind=engine) as db:
        assert metrics(trace) == {}
        assert db.scalar(text("SELECT :private"), {"private": "SECRET-SQL"}) == "SECRET-SQL"
        db.commit()
    values = metrics(trace)
    assert values["db_acquire"] >= 18
    assert values["db_queries"] == 1
    assert 0 <= values["db_query"] < values["db_acquire"]
    assert values["db_commit"] >= 0
    assert "SECRET-SQL" not in trace.record()["spans_json"]
    engine.dispose()


def test_request_timings_cross_worker_context_without_cross_request_leakage():
    async def request(count):
        with TraceContext("test") as trace:
            def work():
                with SessionLocal() as db:
                    for _ in range(count):
                        db.scalar(text("SELECT 1"))
            await asyncio.to_thread(work)
            return metrics(trace)
    async def run():
        return await asyncio.gather(request(2), request(3))
    first, second = asyncio.run(run())
    assert first["db_queries"] == 2
    assert second["db_queries"] == 3
    with TraceContext("empty") as trace:
        assert metrics(trace) == {}


def test_query_failure_is_counted_once_and_does_not_poison_next_query():
    with TraceContext("test") as trace, SessionLocal() as db:
        with pytest.raises(Exception):
            db.execute(text("SELECT SECRET_COLUMN FROM missing_private_table"))
        db.rollback()
        assert db.scalar(text("SELECT 1")) == 1
    values = metrics(trace)
    assert values["db_queries"] == 2
    assert values["db_query"] >= 0
    assert "private_table" not in trace.record()["spans_json"]


def test_stats_header_reports_real_work_and_numeric_fixed_names_only():
    with TestClient(app) as client:
        response = client.get("/api/stats", headers={"X-Client-Id": "SECRET-OWNER"})
    assert response.status_code == 200
    header = response.headers.get("server-timing", "")
    assert 'db_queries;desc="1"' in header
    for name in ("db_acquire", "db_query", "db_commit", "stats_cpu", "response_ready"):
        assert re.search(rf"(?:^|, ){name};dur=\d+\.\d{{3}}(?:,|$)", header)
    assert "SECRET" not in header
    assert all(re.fullmatch(r'[a-z_]+;dur=\d+\.\d{3}|db_queries;desc="\d+"', part) for part in header.split(", "))


def test_unauthorized_and_disabled_requests_do_not_eagerly_acquire(monkeypatch):
    from app.core.config import get_settings
    with TestClient(app) as client:
        rejected = client.get("/api/stats", headers={"Authorization": "Bearer invalid"})
        assert rejected.status_code == 401
        assert "db_acquire" not in rejected.headers.get("server-timing", "")
        monkeypatch.setattr(get_settings(), "telemetry_enabled", False)
        response = client.get("/api/stats", headers={"X-Client-Id": "disabled-test"})
        assert response.status_code == 200
        assert "server-timing" not in response.headers


def test_llm_transport_metrics_and_text_boundaries_are_content_free(monkeypatch):
    from app.services import deepseek
    real_client = httpx.AsyncClient
    async def transport(request):
        hook = request.extensions.get("trace")
        assert hook is not None
        for stage in ("connection.connect_tcp", "connection.start_tls", "http11.receive_response_headers"):
            await hook(stage + ".started", {"host": "SECRET-HOST"})
            await asyncio.sleep(0.001)
            await hook(stage + ".complete", {"return_value": "SECRET-HEADER"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "SECRET-ANSWER"}}]})
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(transport), **kwargs))
    async def run():
        with TraceContext("test") as trace:
            result = await deepseek.DeepSeekClient(Settings(_env_file=None, deepseek_api_key="SECRET-KEY")).chat([
                {"role": "user", "content": "SECRET-PROMPT"}])
            assert result == "SECRET-ANSWER"
            return trace
    trace = asyncio.run(run())
    values = metrics(trace)
    for key in ("llm_tcp", "llm_tls", "llm_headers", "llm_first_text", "llm_total"):
        assert values[key] >= 0
    assert "SECRET" not in trace.record()["spans_json"]


def test_tts_records_first_complete_and_close_without_changing_audio(monkeypatch):
    from app.services import xf_tts
    class Socket:
        async def send(self, data):
            pass
        def __aiter__(self):
            return self.frames()
        async def frames(self):
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x01\x00").decode(), "status": 1}})
            await asyncio.sleep(0.003)
            yield json.dumps({"code": 0, "data": {"audio": base64.b64encode(b"\x02\x00").decode(), "status": 2}})
    class Connection:
        async def __aenter__(self):
            await asyncio.sleep(0.001)
            return Socket()
        async def __aexit__(self, *args):
            await asyncio.sleep(0.005)
    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection())
    async def run():
        with TraceContext("test") as trace:
            service = xf_tts.XfTtsClient(Settings(_env_file=None, xf_app_id="SECRET", xf_api_key="SECRET", xf_api_secret="SECRET"))
            assert await service.synthesize("SECRET-TEXT") == b"\x01\x00\x02\x00"
            return trace
    trace = asyncio.run(run())
    values = metrics(trace)
    assert values["tts_connect"] >= 0
    assert values["tts_first_pcm"] < values["tts_complete_pcm"]
    assert values["tts_close"] >= 4
    assert "SECRET" not in trace.record()["spans_json"]


def test_repeated_listener_install_and_preping_are_measured_once(monkeypatch):
    from app.core.performance import install_sql_timings
    engine = create_engine("sqlite://", pool_pre_ping=True)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    def ping(connection):
        time.sleep(0.02)
        return True
    monkeypatch.setattr(engine.dialect, "do_ping", ping)
    install_sql_timings()
    install_sql_timings()
    with TraceContext("test") as trace, SessionLocal(bind=engine) as db:
        assert db.scalar(text("SELECT 2")) == 2
    values = metrics(trace)
    assert values["db_queries"] == 1
    assert values["db_acquire"] >= 18
    engine.dispose()


def test_failed_acquisition_still_records_duration_without_query_or_private_error():
    def unavailable():
        raise OSError("SECRET-CONNECTION")
    engine = create_engine("sqlite://", creator=unavailable)
    with TraceContext("test") as trace, SessionLocal(bind=engine) as db:
        with pytest.raises(OSError, match="SECRET-CONNECTION"):
            db.scalar(text("SELECT 1"))
    assert metrics(trace)["db_acquire"] >= 0
    assert "db_queries" not in metrics(trace)
    assert "SECRET" not in trace.record()["spans_json"]
    engine.dispose()


def test_streaming_headers_freeze_before_final_provider_metrics():
    from app.core.observability import TelemetryMiddleware
    from app.core.performance import add
    records = []
    messages = []
    async def endpoint(scope, receive, send):
        add("db_queries", 1)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        add("llm_first_text", 12)
        await send({"type": "http.response.body", "body": b"first", "more_body": True})
        add("llm_total", 32)
        await send({"type": "http.response.body", "body": b"last"})
    async def send(message):
        messages.append(message)
    async def receive():
        return {"type": "http.request", "body": b""}
    scope = {"type": "http", "path": "/api/chat/stream", "method": "POST", "headers": [],
             "app": SimpleNamespace(state=SimpleNamespace(telemetry_sink=SimpleNamespace(submit=records.append)))}
    asyncio.run(TelemetryMiddleware(endpoint)(scope, receive, send))
    headers = dict(messages[0]["headers"])
    assert b'db_queries;desc="1"' in headers[b"server-timing"]
    assert b"llm_" not in headers[b"server-timing"]
    measurements = next(n["attributes"] for n in json.loads(records[0]["spans_json"]) if n["name"] == "performance")
    assert measurements["llm_first_text"] == 12
    assert measurements["llm_total"] == 32


def test_numeric_allowlist_rejects_private_strings_nonfinite_and_unknown_keys():
    from app.core.performance import add, server_timing
    with TraceContext("test") as trace:
        for key, value in (("db_query", "SECRET"), ("SECRET-KEY", 1), ("db_acquire", float("inf")),
                           ("db_commit", float("nan")), ("db_queries", -1), ("llm_tls", True)):
            add(key, value)
        assert metrics(trace) == {}
        assert server_timing(trace) == ""


@pytest.mark.parametrize("failure", [httpx.ConnectError("SECRET-UPSTREAM"), asyncio.CancelledError()])
def test_llm_failure_records_finished_transport_stage_without_faking_text(monkeypatch, failure):
    from app.services import deepseek
    real_client = httpx.AsyncClient
    async def transport(request):
        hook = request.extensions["trace"]
        await hook("connection.connect_tcp.started", {})
        await hook("connection.connect_tcp.failed", {"exception": failure})
        raise failure
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(transport), **kwargs))
    async def run():
        with TraceContext("test") as trace:
            with pytest.raises((deepseek.DeepSeekError, asyncio.CancelledError)):
                await deepseek.DeepSeekClient(Settings(_env_file=None, deepseek_api_key="SECRET")).chat([])
            return trace
    trace = asyncio.run(run())
    assert metrics(trace)["llm_tcp"] >= 0
    assert "llm_first_text" not in metrics(trace)
    assert "llm_total" not in metrics(trace)
    assert "SECRET" not in trace.record()["spans_json"]


def test_llm_stream_first_text_precedes_done_and_preserves_deltas(monkeypatch):
    from app.services import deepseek
    real_client = httpx.AsyncClient
    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'data: {"choices":[{"delta":{"content":"one"}}]}\n\n'
            await asyncio.sleep(0.001)
            yield b'data: {"choices":[{"delta":{"content":"two"}}]}\n\ndata: [DONE]\n\n'
    async def transport(request):
        return httpx.Response(200, stream=Body())
    monkeypatch.setattr(deepseek.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(transport), **kwargs))
    async def run():
        with TraceContext("test") as trace:
            stream = deepseek.DeepSeekClient(Settings(_env_file=None, deepseek_api_key="test")).chat_stream([])
            assert await anext(stream) == "one"
            assert "llm_first_text" in metrics(trace)
            assert "llm_total" not in metrics(trace)
            assert [chunk async for chunk in stream] == ["two"]
            return trace
    values = metrics(asyncio.run(run()))
    assert values["llm_total"] > values["llm_first_text"]


def test_tts_cancel_closes_socket_without_faking_complete_pcm(monkeypatch):
    from app.services import xf_tts
    closed = []
    class Socket:
        async def send(self, data):
            pass
        def __aiter__(self):
            return self.frames()
        async def frames(self):
            yield json.dumps({"code": 0, "data": {"audio": "AQA=", "status": 1}})
            raise asyncio.CancelledError()
    class Connection:
        async def __aenter__(self):
            return Socket()
        async def __aexit__(self, *args):
            closed.append(True)
    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection())
    async def run():
        with TraceContext("test") as trace:
            service = xf_tts.XfTtsClient(Settings(_env_file=None, xf_app_id="test", xf_api_key="test", xf_api_secret="test"))
            with pytest.raises(asyncio.CancelledError):
                await service.synthesize("test")
            return trace
    trace = asyncio.run(run())
    assert closed == [True]
    values = metrics(trace)
    assert values["tts_first_pcm"] >= 0
    assert values["tts_close"] >= 0
    assert "tts_complete_pcm" not in values


def test_tts_empty_terminal_frame_does_not_claim_complete_pcm(monkeypatch):
    from app.services import xf_tts
    class Socket:
        async def send(self, data):
            pass
        def __aiter__(self):
            return self.frames()
        async def frames(self):
            yield json.dumps({"code": 0, "data": {"status": 2}})
    class Connection:
        async def __aenter__(self):
            return Socket()
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr(xf_tts.websockets, "connect", lambda *args, **kwargs: Connection())
    async def run():
        with TraceContext("test") as trace:
            service = xf_tts.XfTtsClient(Settings(_env_file=None, xf_app_id="test", xf_api_key="test", xf_api_secret="test"))
            with pytest.raises(xf_tts.XfTtsError, match="no audio"):
                await service.synthesize("test")
            return trace
    values = metrics(asyncio.run(run()))
    assert "tts_first_pcm" not in values
    assert "tts_complete_pcm" not in values
    assert values["tts_close"] >= 0
