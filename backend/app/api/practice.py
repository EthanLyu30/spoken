"""Practice records + aggregate stats endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_client_id
from app.db import get_db
from app.schemas.practice import Insights, PracticeCreate, PracticeRecordOut, Stats
from app.services import practice as repo

router = APIRouter(tags=["practice"])


@router.post("/practice", response_model=PracticeRecordOut, status_code=201)
def save_practice(
    payload: PracticeCreate,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> PracticeRecordOut:
    return PracticeRecordOut.model_validate(repo.create_record(db, client_id, payload))


@router.get("/practice", response_model=list[PracticeRecordOut])
def list_practice(
    kind: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> list[PracticeRecordOut]:
    return [PracticeRecordOut.model_validate(r) for r in repo.list_records(db, client_id, kind, limit)]


@router.get("/stats", response_model=Stats)
def stats(db: Session = Depends(get_db), client_id: str = Depends(get_client_id)) -> Stats:
    return Stats(**repo.compute_stats(db, client_id))


@router.get("/stats/insights", response_model=Insights)
def insights(
    db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> Insights:
    return Insights(**repo.compute_insights(db, client_id))
