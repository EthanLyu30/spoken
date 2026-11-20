"""Practice history and personal coaching endpoints."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.api.chat import get_client
from app.core.deps import get_client_id, get_timezone
from app.core.observability import trace_classify
from app.db import get_db
from app.models.session import PracticeSession
from app.schemas.chat import ChatMessage
from app.schemas.coaching import CoachingPlan, CoachingSnapshot, GrammarStatistics
from app.schemas.feedback import SkillScore
from app.schemas.session import ExpiredSessionReceipt, ProgressSessions, SaveSessionRequest, SessionDetail, SessionSummary
from app.services import sessions as repo
from app.services.coaching import UnsupportedPracticeTarget, coaching_snapshot, generate_plan, select_plan_targets
from app.services.corrections import read_corrections
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.grammar_statistics import grammar_statistics

router = APIRouter(tags=["sessions"])


def _detail(session: PracticeSession) -> SessionDetail:
    return SessionDetail(
        id=session.id,
        scenario_id=session.scenario_id,
        overall=session.reported_score,
        client_session_id=session.client_session_id if not session.scored else None,
        created_at=session.created_at,
        summary=session.summary,
        tip=session.tip,
        scores=[
            SkillScore(key=s.key, label_en=s.label_en, label_zh=s.label_zh, score=s.score)
            for s in session.scores
        ],
        messages=[ChatMessage(role=t.role, content=t.content) for t in session.turns],
        corrections=read_corrections(session.corrections, session.id),
        custom=session.custom,
    )


@router.post("/sessions", response_model=SessionDetail | ExpiredSessionReceipt, status_code=201)
def save_session(
    payload: SaveSessionRequest,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
    timezone: str = Depends(get_timezone),
) -> SessionDetail | ExpiredSessionReceipt:
    saved = repo.create_session(db, client_id, payload, timezone)
    return saved if isinstance(saved, ExpiredSessionReceipt) else _detail(saved)


@router.get("/sessions", response_model=list[SessionSummary])
def list_sessions(
    db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> list[SessionSummary]:
    return [SessionSummary.model_validate(s) for s in repo.list_sessions(db, client_id)]


@router.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: int, response: Response, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> SessionDetail:
    session = repo.get_session(db, client_id, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    response.headers["Cache-Control"] = "no-store"
    return _detail(session)


@router.get("/progress/sessions", response_model=ProgressSessions)
def progress_sessions(
    db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> ProgressSessions:
    return ProgressSessions.model_validate(repo.progress_sessions(db, client_id))


@router.get("/progress/coaching", response_model=CoachingSnapshot)
def get_coaching(response: Response, scene: str | None = Query(default=None, max_length=64),
                 db: Session = Depends(get_db), client_id: str = Depends(get_client_id)) -> CoachingSnapshot:
    response.headers["Cache-Control"] = "no-store"
    snapshot = coaching_snapshot(db, client_id, scene)
    _, targets = select_plan_targets(snapshot)
    snapshot.can_generate_plan = bool(targets)
    return snapshot


@router.get("/progress/grammar", response_model=GrammarStatistics)
def get_grammar_statistics(response: Response, db: Session = Depends(get_db),
                           client_id: str = Depends(get_client_id)) -> GrammarStatistics:
    response.headers["Cache-Control"] = "no-store"
    return grammar_statistics(db, client_id)


@router.post("/progress/coaching/plan", response_model=CoachingPlan)
async def create_coaching_plan(response: Response, db: Session = Depends(get_db),
                               client_id: str = Depends(get_client_id),
                               client: DeepSeekClient = Depends(get_client),
                               revision: str = Query(pattern=r"^[a-f0-9]{64}$")) -> CoachingPlan:
    snapshot = await asyncio.to_thread(coaching_snapshot, db, client_id)
    db.rollback()  # Release the owner lock before waiting for the coach.
    if revision != snapshot.revision:
        raise HTTPException(status_code=409, detail="练习记录已更新，请重新生成训练计划。")
    if not snapshot.plan_examples:
        raise HTTPException(status_code=400, detail="完成一次有纠错记录的练习后，就能生成训练计划。")
    response.headers["Cache-Control"] = "no-store"
    try:
        async with asyncio.timeout(25):
            plan = await generate_plan(snapshot, client)
    except UnsupportedPracticeTarget as exc:
        trace_classify(type(exc).__name__, "unverifiable_target")
        raise HTTPException(status_code=422, detail={
            "code": "coaching_target_unsupported",
            "message": "这条错句暂时无法生成专项题，可以先重说原句。",
        }) from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="训练计划生成超时，请重试。") from exc
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail="训练计划暂时无法生成，请稍后再试。") from exc
    current = await asyncio.to_thread(coaching_snapshot, db, client_id)
    if current.revision != snapshot.revision:
        raise HTTPException(status_code=409, detail="练习记录已更新，请重新生成训练计划。")
    return plan
