"""Generate a fresh batch of short English lines to shadow (DeepSeek)."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from app.api.chat import get_client
from app.schemas.daily import DailyLine, DailyLinesResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["daily"])

_SYSTEM = """Generate {n} short, uplifting English sentences for a Chinese learner to read aloud — a mix of famous quotes and useful everyday lines. Each must sound natural and be at most 14 words.

Return ONLY a JSON object: {{"lines": [{{"text": "...", "author": "a name or Anonymous", "zh": "中文翻译", "usage": "一句话中文说明什么时候用这句话"}}]}}."""


@router.get("/daily-lines", response_model=DailyLinesResponse)
async def daily_lines(
    n: int = Query(5, ge=1, le=8),
    client: DeepSeekClient = Depends(get_client),
) -> DailyLinesResponse:
    messages = [
        {"role": "system", "content": _SYSTEM.format(n=n)},
        {"role": "user", "content": "Give me a fresh set of lines to practise."},
    ]
    try:
        raw = await client.chat(
            messages,
            temperature=0.95,
            max_tokens=600,
            response_format={"type": "json_object"},
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        lines = [DailyLine(**item) for item in data.get("lines", []) if isinstance(item, dict)]
        if not lines:
            raise ValueError("no lines")
        return DailyLinesResponse(lines=lines[:n])
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse daily lines") from exc
