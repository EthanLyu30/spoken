"""On-demand grammar and expression feedback for one learner turn."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.data import scenarios as catalog
from app.schemas.turn_correction import (
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.turn_correction import generate_turn_correction
from app.core.observability import trace_classify

router = APIRouter(tags=["turn-correction"])


@router.post("/turn-correction", response_model=TurnCorrectionResponse)
async def turn_correction(
    request: TurnCorrectionRequest,
    client: DeepSeekClient = Depends(get_client),
) -> TurnCorrectionResponse:
    if request.custom is not None:
        scenario = catalog.scene_from_custom(request.custom)
    else:
        scenario = catalog.get_scenario(request.scenario_id)
        if scenario is None:
            raise HTTPException(
                status_code=404,
                detail=f"Unknown scenario: {request.scenario_id}",
            )
    try:
        # A stalled upstream must not leave a learner waiting for the client's
        # 60 s default. This is a small optional analysis, so fail/reuse quickly.
        async with asyncio.timeout(15):
            return await generate_turn_correction(scenario, request, client)
    except TimeoutError as exc:
        raise HTTPException(
            status_code=503,
            detail="纠错分析超时，请稍后重试。",
        ) from exc
    except DeepSeekError as exc:
        trace_classify("TurnCorrectionError", type(exc.__cause__).__name__ if exc.__cause__ else None)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
