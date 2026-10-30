"""Bounded, untrusted browser measurements. No content or arbitrary metadata."""
from collections import OrderedDict
from datetime import datetime, timezone
import json
import secrets
from time import monotonic

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import ValidationError

from app.schemas.telemetry import BrowserTiming

router = APIRouter(prefix="/telemetry", tags=["telemetry"])
_rates = OrderedDict()


@router.post("/client", status_code=202)
async def client_timing(request: Request):
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
        sink.submit({"trace_id": secrets.token_hex(16), "interaction_id": event.interaction_id, "started_at": datetime.now(timezone.utc).replace(tzinfo=None),
            "operation": event.operation, "source": "browser", "outcome": event.outcome,
            "duration_ms": event.duration_ms, "release": event.release, "model": f"{event.engine}/{event.transport}", "spans_json": json.dumps([
                {"id": secrets.token_hex(8), "parent_id": None, "name": event.operation, "offset_ms": 0,
                 "duration_ms": event.duration_ms, "outcome": event.outcome, "attributes": {"engine": event.engine, "transport": event.transport}}
            ])})
    return Response(status_code=202)
