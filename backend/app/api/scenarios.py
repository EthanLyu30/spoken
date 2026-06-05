"""Scenario catalogue endpoints."""

from fastapi import APIRouter, HTTPException

from app.data import scenarios as catalog
from app.schemas.scenario import ScenarioPublic

router = APIRouter(tags=["scenarios"])


@router.get("/scenarios", response_model=list[ScenarioPublic])
def list_scenarios() -> list[ScenarioPublic]:
    return catalog.list_public()


@router.get("/scenarios/{scenario_id}", response_model=ScenarioPublic)
def get_scenario(scenario_id: str) -> ScenarioPublic:
    scenario = catalog.get_public(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"Unknown scenario: {scenario_id}")
    return scenario
