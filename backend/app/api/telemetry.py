"""Bounded, untrusted browser measurements. No content or arbitrary metadata."""
from collections import OrderedDict
import asyncio
from datetime import datetime, timezone
import hashlib
import json
import secrets
import re
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from pydantic import ValidationError

from app.schemas.telemetry import BrowserTiming, SINK_DIAGNOSTIC_FIELDS
from app.core.config import get_settings
from app.core.deps import authenticated_user, get_optional_client_id
from app.db import get_db
from app.services.monitoring import record_visit

router = APIRouter(prefix="/telemetry", tags=["telemetry"])
_rates = OrderedDict()


@router.post('/visit', status_code=204)
async def site_visit(request: Request, client_id: str = Depends(get_optional_client_id), db: Session = Depends(get_db)):
    host = request.client.host if request.client else 'unknown'
    key = ('visit', host, int(monotonic() // 60))
    if _rates.get(key, 0) >= 60:
        raise HTTPException(status_code=429, detail='Too many visit samples')
    _rates[key] = _rates.get(key, 0) + 1
    _rates.move_to_end(key)
    while len(_rates) > 4096:
        _rates.popitem(last=False)
    if client_id.startswith("u:"):
        await asyncio.to_thread(authenticated_user, db, request.headers.get("authorization"), lock_progress=True)
    await asyncio.to_thread(record_visit, db, client_id)
    return Response(status_code=204)


@router.post("/client", status_code=202)
async def client_timing(request: Request):
    # A text/plain body avoids the cross-origin preflight. Validate Origin on
    # the POST itself so unrelated web pages still cannot submit samples.
    origin = request.headers.get("origin")
    if origin:
        allowed = get_settings().cors_origin_list
        same_origin = f"{request.url.scheme}://{request.url.netloc}"
        if origin != same_origin and origin not in allowed and "*" not in allowed:
            raise HTTPException(status_code=403, detail="Origin not allowed")
    host = request.client.host if request.client else "unknown"
    minute = int(monotonic() // 60)
    key = (host, minute)
    count = _rates.get(key, 0)
    if count >= 180:
        raise HTTPException(status_code=429, detail="Too many telemetry samples")
    _rates[key] = count + 1
    _rates.move_to_end(key)
    while len(_rates) > 4096:
        _rates.popitem(last=False)
    payload = bytearray()
    async for chunk in request.stream():
        payload.extend(chunk)
        if len(payload) > 4096:
            raise HTTPException(status_code=413, detail="Telemetry payload too large")
    try:
        event = BrowserTiming.model_validate_json(payload)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Invalid telemetry payload") from None
    sink = getattr(request.app.state, "telemetry_sink", None)
    if sink:
        diagnostics = event.model_dump(include=SINK_DIAGNOSTIC_FIELDS, exclude_none=True)
        if event.asr_reason:
            diagnostics["asr_reason"] = event.asr_reason
        header_test_run = request.headers.get("x-test-run-id", "")
        test_run_id = event.test_run_id or (header_test_run if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", header_test_run) else None)
        # Retrying an accepted browser event must neither duplicate it nor let
        # the caller pick a trace ID in the server's namespace.
        trace_id = (hashlib.sha256(f"spoken-browser-v1/{event.event_id}".encode()).hexdigest()[:32]
                    if event.event_id else secrets.token_hex(16))
        accepted = sink.submit({"trace_id": trace_id, "interaction_id": event.interaction_id,
            "test_run_id": test_run_id, "started_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "operation": event.operation, "source": "browser", "outcome": event.outcome,
            "duration_ms": event.duration_ms, "release": event.release, "model": f"{event.engine}/{event.transport}", "spans_json": json.dumps([
                {"id": secrets.token_hex(8), "parent_id": None, "name": event.operation, "offset_ms": 0,
                 "duration_ms": event.duration_ms, "outcome": event.outcome, "attributes": {"engine": event.engine, "transport": event.transport, **diagnostics}}
            ])})
        if accepted is False:
            raise HTTPException(status_code=503, detail="Telemetry collector busy")
    return Response(status_code=202)
