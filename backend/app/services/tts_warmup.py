"""Bounded, one-use provider handshakes. No text or credentials leave this owner."""

import asyncio
from collections import deque
from contextvars import Context
import secrets
from time import monotonic

from app.core.performance import add, measure


class PreparedConnection:
    def __init__(self, connection, clock):
        self.connection = connection
        self.clock = clock
        self.created_at = clock()
        self.connect_ms = 0.0
        self.task = None
        self.timer = None
        self.entered = False
        self.released = False

    async def open(self):
        started = self.clock()
        socket = await self.connection.__aenter__()
        self.connect_ms = max(0.0, (self.clock() - started) * 1000)
        return socket

    def ready(self):
        if not self.task.done() or self.task.cancelled() or self.task.exception() is not None:
            return False
        socket = self.task.result()
        state = getattr(socket, "state", None)
        return getattr(state, "name", None) == "OPEN" if state is not None else not getattr(socket, "closed", False)

    async def __aenter__(self):
        if self.entered or self.released or not self.ready():
            raise RuntimeError("Prepared connection is no longer available")
        self.entered = True
        return self.task.result()

    async def __aexit__(self, *args):
        if self.released:
            return False
        self.released = True
        with measure("tts_close"):
            return await self.connection.__aexit__(*args)

    async def close(self):
        if self.released:
            return
        if not self.task.done():
            self.task.cancel()
        try:
            await self.task
        except BaseException:
            return  # A failed/cancelled __aenter__ never transferred a socket.
        try:
            await self.__aexit__(None, None, None)
        except Exception:
            pass  # Idle cleanup must not expose signed provider URLs.


def _observe(task):
    if not task.cancelled():
        task.exception()


class TtsWarmupPool:
    def __init__(self, *, ttl=4.0, capacity=4, starts_per_second=4, clock=monotonic):
        self.ttl = ttl
        self.capacity = capacity
        self.starts_per_second = starts_per_second
        self.clock = clock
        self.entries = {}
        self.starts = deque()
        self.cleanup = set()
        self.closed = False

    def reserve(self, factory):
        now = self.clock()
        while self.starts and now - self.starts[0] >= 1.0:
            self.starts.popleft()
        if self.closed or len(self.entries) >= self.capacity or len(self.starts) >= self.starts_per_second:
            return None
        self.starts.append(now)
        entry = PreparedConnection(factory(), self.clock)
        ticket = secrets.token_hex(16)
        self.entries[ticket] = entry
        # Request ContextVars include a trace that can finish before this job.
        entry.task = asyncio.create_task(entry.open(), context=Context())
        entry.task.add_done_callback(_observe, context=Context())
        entry.timer = asyncio.get_running_loop().call_later(self.ttl, self.discard, ticket, context=Context())
        return ticket

    def _remove(self, ticket):
        entry = self.entries.pop(ticket, None)
        if entry is not None:
            entry.timer.cancel()
        return entry

    def _dispose(self, entry):
        task = asyncio.create_task(entry.close(), context=Context())
        self.cleanup.add(task)
        task.add_done_callback(self.cleanup.discard, context=Context())
        task.add_done_callback(_observe, context=Context())

    def discard(self, ticket):
        entry = self._remove(ticket)
        if entry is not None:
            self._dispose(entry)

    def take(self, ticket):
        entry = self._remove(ticket)
        if entry is not None and self.clock() - entry.created_at < self.ttl and entry.ready():
            add("tts_warmup_hit", 1)
            add("tts_warmup_age", max(0.0, (self.clock() - entry.created_at) * 1000))
            add("tts_warmup_connect", entry.connect_ms)
            return entry
        if entry is not None:
            self._dispose(entry)
        add("tts_warmup_miss", 1)
        return None

    async def close(self):
        self.closed = True
        for ticket in list(self.entries):
            self.discard(ticket)
        if self.cleanup:
            await asyncio.gather(*list(self.cleanup), return_exceptions=True)
