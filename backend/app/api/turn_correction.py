"""On-demand grammar and expression feedback for one learner turn."""

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.data import scenarios as catalog
from app.schemas.turn_correction import (
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.turn_correction import generate_turn_correction

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
        return await generate_turn_correction(scenario, request, client)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
