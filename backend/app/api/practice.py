"""Practice records + aggregate stats endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_client_id, get_timezone
from app.db import get_db
from app.schemas.practice import Insights, PracticeCreate, PracticeRecordOut, Stats
from app.services import practice as repo
from app.models.practice import PracticeRecord
from app.schemas.practice import PracticeDetailOut

router = APIRouter(tags=["practice"])


@router.post("/practice", response_model=PracticeRecordOut, status_code=201)
def save_practice(
    payload: PracticeCreate,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
    timezone: str = Depends(get_timezone),
) -> PracticeRecordOut:
    return PracticeRecordOut.model_validate(repo.create_record(db, client_id, payload, timezone))


@router.get("/practice", response_model=list[PracticeRecordOut])
def list_practice(
    kind: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> list[PracticeRecordOut]:
    return [PracticeRecordOut.model_validate(r) for r in repo.list_records(db, client_id, kind, limit)]


@router.get("/stats", response_model=Stats)
def stats(db: Session = Depends(get_db), client_id: str = Depends(get_client_id),
          timezone: str = Depends(get_timezone)) -> Stats:
    return Stats(**repo.compute_stats(db, client_id, timezone))


@router.get("/practice/{record_id}", response_model=PracticeDetailOut)
def practice_detail(
    record_id: int, db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> PracticeDetailOut:
    record = db.scalar(select(PracticeRecord).where(
        PracticeRecord.id == record_id, PracticeRecord.client_id == client_id,
    ))
    if record is None:
        raise HTTPException(status_code=404, detail="Practice record not found")
    return PracticeDetailOut.model_validate(record)


@router.get("/stats/insights", response_model=Insights)
def insights(
    db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> Insights:
    return Insights(**repo.compute_insights(db, client_id))
