"""Fixed-name, numeric request diagnostics; never retain SQL or provider data."""
from contextlib import asynccontextmanager, contextmanager
from time import perf_counter, thread_time

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session


METRICS = frozenset({
    "db_acquire", "db_query", "db_queries", "db_commit", "stats_cpu", "insights_cpu",
    "response_ready", "llm_tcp", "llm_tls", "llm_headers", "llm_first_text", "llm_total",
    "tts_connect", "tts_first_pcm", "tts_complete_pcm", "tts_close",
})


def current():
    # Import lazily: observability owns context; SQL instrumentation also runs at boot.
    from app.core.observability import _current
    return _current.get()


def numeric(values):
    return {k: v for k, v in values.items()
            if k in METRICS and type(v) in (int, float) and 0 <= v <= 1e12}


def add(name, value, *, trace=None):
    trace = trace if trace is not None else current()
    if trace is not None and name in METRICS and type(value) in (int, float) and 0 <= value <= 1e12:
        with trace.performance_lock:
            trace.performance[name] = min(1e12, trace.performance.get(name, 0) + value)


def elapsed(name, start):
    add(name, max(0, (perf_counter() - start) * 1000))


@contextmanager
def measure(name, *, cpu=False):
    trace = current()
    if trace is None:
        yield
        return
    clock = thread_time if cpu else perf_counter
    start = clock()
    try:
        yield
    finally:
        add(name, max(0, (clock() - start) * 1000), trace=trace)


def server_timing(trace):
    with trace.performance_lock:
        values = numeric(trace.performance)
    return ", ".join(f'{name};desc="{int(value)}"' if name == "db_queries" else f"{name};dur={value:.3f}"
                     for name, value in sorted(values.items()))


class MeasuredSession(Session):
    def _connection_for_bind(self, *args, **kwargs):
        # The SQLAlchemy 2.x lazy seam includes pool wait, physical connect, pre-ping
        # and transaction setup. Warm transaction lookups are included as well.
        # Never call connection() in get_db: auth validation must remain first.
        with measure("db_acquire"):
            return super()._connection_for_bind(*args, **kwargs)

    def commit(self):
        # Includes flush and transaction commit; overlaps query time if flush emits SQL.
        with measure("db_commit"):
            return super().commit()


def _before_cursor(conn, cursor, statement, parameters, context, executemany):
    trace = current()
    if trace is not None:
        context._spoken_timing = (trace, perf_counter())


def _finish_cursor(context):
    timing = getattr(context, "_spoken_timing", None)
    if timing is not None:
        context._spoken_timing = None
        trace, start = timing
        add("db_queries", 1, trace=trace)
        add("db_query", max(0, (perf_counter() - start) * 1000), trace=trace)


def _after_cursor(conn, cursor, statement, parameters, context, executemany):
    _finish_cursor(context)


def _cursor_error(exception_context):
    _finish_cursor(exception_context.execution_context)


def install_sql_timings():
    # Class listeners also cover test-bound sessions; registration is idempotent.
    for name, callback in (("before_cursor_execute", _before_cursor),
                           ("after_cursor_execute", _after_cursor),
                           ("handle_error", _cursor_error)):
        if not event.contains(Engine, name, callback):
            event.listen(Engine, name, callback)


class HttpTimings:
    """HTTPcore's trace extension supplies phase names; info is deliberately ignored."""
    _names = {"connection.connect_tcp": "llm_tcp", "connection.start_tls": "llm_tls",
              "http11.receive_response_headers": "llm_headers",
              "http2.receive_response_headers": "llm_headers"}

    def __init__(self):
        self.starts = {}

    async def __call__(self, event_name, info):
        phase, _, status = event_name.rpartition(".")
        metric = self._names.get(phase)
        if metric is None:
            return
        if status == "started":
            self.starts[phase] = perf_counter()
        elif status in {"complete", "failed"}:
            start = self.starts.pop(phase, None)
            if start is not None:
                elapsed(metric, start)


@asynccontextmanager
async def measured_tts_connection(connection):
    close_start = None
    try:
        # Time the actual __aenter__, preserving the library's normal __aexit__
        # exception/cancellation semantics and the caller's outer timeout.
        with measure("tts_connect"):
            ws = await connection.__aenter__()
        try:
            yield ws
        except BaseException as exc:
            close_start = perf_counter()
            if not await connection.__aexit__(type(exc), exc, exc.__traceback__):
                raise
        else:
            close_start = perf_counter()
            await connection.__aexit__(None, None, None)
    finally:
        if close_start is not None:
            elapsed("tts_close", close_start)
