"""Monotonic, task-local spans. Never collect request/response content."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from functools import wraps
import os
import json
import secrets
import re
from time import perf_counter

from app.core.config import get_settings

_current: ContextVar[TraceContext | None] = ContextVar("spoken_trace", default=None)
_parent: ContextVar[str | None] = ContextVar("spoken_span", default=None)
_span_data: ContextVar[dict | None] = ContextVar("spoken_span_data", default=None)
_ATTRS = {"provider", "model", "attempt", "cache_hit", "input_tokens", "output_tokens",
          "input_chars", "output_chars", "audio_bytes", "engine", "transport",
          "error_type", "ttft_ms", "scoring_version", "answer_count"}


def _attributes(values):
    return {k: (v[:100] if isinstance(v, str) else v) for k, v in values.items()
            if k in _ATTRS and (isinstance(v, (str, bool, int)) or
                               isinstance(v, float) and 0 <= v <= 1e12)}


def _outcome(exc):
    if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
        return "cancelled"
    if "timeout" in type(exc).__name__.lower() or "timeout" in type(exc.__cause__).__name__.lower():
        return "timeout"
    return "error"


class TraceContext:
    def __init__(self, operation: str, *, source="server", interaction_id=None):
        self.trace_id = secrets.token_hex(16)
        self.operation = operation
        self.source = source
        self.interaction_id = interaction_id
        self.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        self.start = perf_counter()
        self.duration_ms = None
        self.outcome = "ok"
        self.http_status = None
        self.spans = []

    def __enter__(self):
        self._token = _current.set(self)
        self._parent_token = _parent.set(None)
        return self

    def __exit__(self, kind, exc, tb):
        if exc is not None:
            self.outcome = _outcome(exc)
        self.duration_ms = max(0, (perf_counter() - self.start) * 1000)
        _parent.reset(self._parent_token)
        _current.reset(self._token)

    def record(self):
        models = [s["attributes"] for s in self.spans if s["name"].startswith("deepseek.")]
        complete = bool(models) and all(type(m.get("input_tokens")) is int and type(m.get("output_tokens")) is int for m in models)
        first = [m["ttft_ms"] for m in models if isinstance(m.get("ttft_ms"), (float, int))]
        return {"trace_id": self.trace_id, "interaction_id": self.interaction_id, "started_at": self.started_at,
                "operation": self.operation[:120], "source": self.source,
                "outcome": self.outcome, "http_status": self.http_status,
                "duration_ms": self.duration_ms if self.duration_ms is not None else (perf_counter()-self.start)*1000,
                "ttft_ms": min(first) if first else None,
                "input_tokens": sum(m["input_tokens"] for m in models) if complete else None,
                "output_tokens": sum(m["output_tokens"] for m in models) if complete else None,
                "model": models[0].get("model") if models else None,
                "release": os.environ.get("RENDER_GIT_COMMIT", "unknown")[:80],
                "spans_json": json.dumps(self.spans, ensure_ascii=True)}


@contextmanager
def span(name: str, **attributes):
    trace = _current.get()
    data = _attributes(attributes)
    if trace is None or len(trace.spans) >= 64:
        token = _span_data.set(data)
        try:
            yield data
        finally:
            _span_data.reset(token)
        return
    start = perf_counter()
    node = {"id": secrets.token_hex(8), "parent_id": _parent.get(), "name": name[:100],
            "offset_ms": max(0, (start-trace.start)*1000), "duration_ms": 0, "outcome": "ok", "attributes": {}}
    # Reserve before awaiting, so concurrent/long-lived children respect the cap.
    trace.spans.append(node)
    token = _parent.set(node["id"])
    data_token = _span_data.set(data)
    try:
        yield data
    except BaseException as exc:
        node["outcome"] = _outcome(exc)
        data["error_type"] = type(exc).__name__[:100]
        raise
    finally:
        node["duration_ms"] = max(0, (perf_counter()-start)*1000)
        node["attributes"] = _attributes(data)
        _parent.reset(token)
        _span_data.reset(data_token)


def trace_attribute(key, value):
    data = _span_data.get()
    if data is not None and key in _ATTRS:
        data.update(_attributes({key: value}))


def trace_error(kind="error"):
    if isinstance(kind, BaseException):
        kind = _outcome(kind)
    trace = _current.get()
    if trace and kind in {"error", "timeout", "cancelled"}:
        trace.outcome = kind


def traced(name: str, **attributes):
    def decorate(fn):
        @wraps(fn)
        async def wrapped(*args, **kwargs):
            with span(name, **attributes):
                return await fn(*args, **kwargs)
        return wrapped
    return decorate


def traced_stream(name: str, **attributes):
    """Do not hold ContextVar tokens across yields: TTS changes ASGI tasks."""
    def decorate(fn):
        @wraps(fn)
        async def wrapped(*args, **kwargs):
            trace = _current.get()
            iterator = fn(*args, **kwargs)
            if trace is None or len(trace.spans) >= 64:
                try:
                    async for item in iterator:
                        yield item
                finally:
                    await iterator.aclose()
                return
            start = perf_counter()
            data = _attributes(attributes)
            node = {"id": secrets.token_hex(8), "parent_id": _parent.get(), "name": name,
                    "offset_ms": max(0, (start-trace.start)*1000), "duration_ms": 0,
                    "outcome": "ok", "attributes": {}}
            trace.spans.append(node)
            first = True
            try:
                while True:
                    parent_token = _parent.set(node["id"])
                    data_token = _span_data.set(data)
                    try:
                        item = await anext(iterator)
                    except StopAsyncIteration:
                        break
                    finally:
                        _parent.reset(parent_token)
                        _span_data.reset(data_token)
                    if first:
                        data["ttft_ms"] = max(0, (perf_counter()-start)*1000)
                        first = False
                    yield item
            except BaseException as exc:
                node["outcome"] = _outcome(exc)
                data["error_type"] = type(exc).__name__
                raise
            finally:
                try:
                    await iterator.aclose()
                finally:
                    node["duration_ms"] = max(0, (perf_counter()-start)*1000)
                    node["attributes"] = _attributes(data)
        return wrapped
    return decorate


class TelemetryMiddleware:
    """Pure ASGI pass-through: timings include the final streaming body."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if (scope["type"] != "http" or not path.startswith("/api/") or
                path.startswith(("/api/admin", "/api/telemetry", "/api/auth", "/api/health")) or
                scope.get("method") == "OPTIONS" or not get_settings().telemetry_enabled):
            return await self.app(scope, receive, send)
        interaction = next((value for key, value in scope.get("headers", []) if key.lower() == b"x-interaction-id"), b"")
        interaction_id = interaction.decode("ascii") if re.fullmatch(b"[a-f0-9]{32}", interaction) else None
        trace = TraceContext(operation="unmatched", interaction_id=interaction_id)

        async def observe(message):
            if message["type"] == "http.response.start":
                trace.http_status = message["status"]
                message = {**message, "headers": [*message.get("headers", []), (b"x-trace-id", trace.trace_id.encode())]}
            await send(message)

        try:
            with trace:
                await self.app(scope, receive, observe)
                if trace.http_status and trace.http_status >= 400 and trace.outcome == "ok":
                    trace.outcome = "timeout" if any(s["outcome"] == "timeout" for s in trace.spans) else "error"
        finally:
            route = scope.get("route")
            canonical = getattr(route, "path", "/api/unmatched")
            if not canonical.startswith("/api/"):
                canonical = "/api" + canonical
            trace.operation = f'{scope.get("method", "GET")} {canonical}'
            sink = getattr(scope["app"].state, "telemetry_sink", None)
            if sink:
                sink.submit(trace.record())
