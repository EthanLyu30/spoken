"""Post-session feedback endpoint (DeepSeek-powered, text path)."""

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.data import scenarios as catalog
from app.schemas.feedback import FeedbackRequest, FeedbackResponse
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.feedback import generate_feedback

router = APIRouter(tags=["feedback"])


@router.post("/feedback", response_model=FeedbackResponse)
async def feedback(
    req: FeedbackRequest, client: DeepSeekClient = Depends(get_client)
) -> FeedbackResponse:
    if req.custom is not None:
        scenario = catalog.scene_from_custom(req.custom)
    else:
        scenario = catalog.get_scenario(req.scenario_id)
        if scenario is None:
            raise HTTPException(
                status_code=404, detail=f"Unknown scenario: {req.scenario_id}"
            )
    if not any(m.role == "user" for m in req.messages):
        raise HTTPException(
            status_code=400, detail="Need at least one learner turn to give feedback"
        )
    try:
        return await generate_feedback(scenario, req.messages, client)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
