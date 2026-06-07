"""Practice-session history endpoints (save / list / detail)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_client_id
from app.db import get_db
from app.models.session import PracticeSession
from app.schemas.chat import ChatMessage
from app.schemas.feedback import SkillScore
from app.schemas.session import SaveSessionRequest, SessionDetail, SessionSummary
from app.services import sessions as repo

router = APIRouter(tags=["sessions"])


def _detail(session: PracticeSession) -> SessionDetail:
    return SessionDetail(
        id=session.id,
        scenario_id=session.scenario_id,
        overall=session.overall,
        created_at=session.created_at,
        summary=session.summary,
        tip=session.tip,
        scores=[
            SkillScore(key=s.key, label_en=s.label_en, label_zh=s.label_zh, score=s.score)
            for s in session.scores
        ],
        messages=[ChatMessage(role=t.role, content=t.content) for t in session.turns],
    )


@router.post("/sessions", response_model=SessionDetail, status_code=201)
def save_session(
    payload: SaveSessionRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> SessionDetail:
    return _detail(repo.create_session(db, client_id, payload))


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(
    db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> list[SessionSummary]:
    return [SessionSummary.model_validate(s) for s in repo.list_sessions(db, client_id)]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: int, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> SessionDetail:
    session = repo.get_session(db, client_id, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _detail(session)
