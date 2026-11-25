"""Practice records + aggregate stats endpoints."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_client_id, get_timezone
from app.db import get_db
from app.schemas.practice import Insights, PracticeCreate, PracticeRecordOut, Stats
from app.services import practice as repo
from app.services.history_deletion import HistoryRecordChanged, delete_record, matches_created_at
from app.services.request_receipts import DeletedPracticeRecord, RequestConflict
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
    try:
        return PracticeRecordOut.model_validate(repo.create_record(db, client_id, payload, timezone))
    except DeletedPracticeRecord as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    except RequestConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/practice", response_model=list[PracticeRecordOut])
def list_practice(
    response: Response,
    kind: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> list[PracticeRecordOut]:
    response.headers["Cache-Control"] = "no-store"
    return [PracticeRecordOut.model_validate(r) for r in repo.list_records(db, client_id, kind, limit)]


@router.get("/stats", response_model=Stats)
def stats(response: Response, db: Session = Depends(get_db), client_id: str = Depends(get_client_id),
          timezone: str = Depends(get_timezone)) -> Stats:
    response.headers["Cache-Control"] = "no-store"
    return Stats(**repo.compute_stats(db, client_id, timezone))


@router.get("/practice/{record_id}", response_model=PracticeDetailOut)
def practice_detail(
    record_id: int, response: Response, created_at: datetime | None = None, db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> PracticeDetailOut:
    record = db.scalar(select(PracticeRecord).where(
        PracticeRecord.id == record_id, PracticeRecord.client_id == client_id,
    ))
    if record is None or (created_at is not None and not matches_created_at(record.created_at, created_at)):
        raise HTTPException(status_code=404, detail="Practice record not found", headers={"Cache-Control": "no-store"})
    response.headers["Cache-Control"] = "no-store"
    return PracticeDetailOut.model_validate(record)


@router.delete("/practice/{record_id}", status_code=204)
def delete_practice(
    record_id: int, created_at: datetime, db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> Response:
    try:
        deleted = delete_record(db, client_id, PracticeRecord, record_id, created_at)
    except HistoryRecordChanged as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Practice record not found")
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/stats/insights", response_model=Insights)
def insights(
    response: Response, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> Insights:
    response.headers["Cache-Control"] = "no-store"
    return Insights(**repo.compute_insights(db, client_id))
