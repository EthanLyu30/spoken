"""Word-bag endpoints: save, organize, review and check collected words."""

from json import JSONDecodeError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.chat import get_client
from app.core.deps import authenticated_user, get_client_id, get_optional_client_id, get_timezone
from app.db import get_db
from app.schemas.word import Word, WordCreate, WordReview, WordTopicChange, WordTranslation, WordTranslationGrade, WordUpdate
from app.schemas.word_retest import RetestRating, RetestRound, RetestState, StartRetest
from app.services import words as repo
from app.services import word_retest
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.request_receipts import RequestConflict
from app.services.users import GuestAlreadyClaimed

router = APIRouter(tags=["words"])


@router.post("/words", response_model=Word, status_code=201)
async def add_word(
    payload: WordCreate,
    request: Request,
    db: Session = Depends(get_db),
    client: DeepSeekClient = Depends(get_client),
    client_id: str = Depends(get_client_id),
    timezone: str = Depends(get_timezone),
) -> Word:
    text = payload.text.strip()
    claim_aware = request.headers.get("X-Claim-Protocol") == "1" and not client_id.startswith("u:")
    # Idempotent: collecting the same text twice returns the existing entry.
    existing = repo.find_by_text(db, client_id, text)
    if existing is not None and not claim_aware:
        return Word.model_validate(existing)

    meaning = payload.meaning.strip()
    example = payload.example.strip()
    if existing is not None:
        meaning = meaning or existing.meaning
        example = example or existing.example
    elif not meaning or not example:
        m, e = await repo.define_word(text, client)
        meaning = meaning or m
        example = example or e
    if client_id.startswith("u:"):
        authenticated_user(db, request.headers.get("authorization"), lock_progress=True)
    try:
        entry = repo.create_word(
            db, client_id, text, payload.scenario_id, meaning, example, payload.kind, timezone,
            claim_aware=claim_aware, topic=payload.topic, source=payload.source,
        )
    except GuestAlreadyClaimed as exc:
        raise HTTPException(status_code=409, detail="guest_data_claimed") from exc
    return Word.model_validate(entry)


@router.get("/words", response_model=list[Word])
def list_words(db: Session = Depends(get_db), client_id: str = Depends(get_client_id)) -> list[Word]:
    return [Word.model_validate(w) for w in repo.list_words(db, client_id)]


@router.get("/words/due", response_model=list[Word])
def list_due_words(
    kind: str | None = None, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> list[Word]:
    return [Word.model_validate(w) for w in repo.list_due(db, client_id, kind)]


@router.get("/words/retest", response_model=RetestState)
def retest_state(response: Response, db: Session = Depends(get_db), owner: str = Depends(get_client_id)) -> RetestState:
    response.headers["Cache-Control"] = "private, no-store"
    return word_retest.read(db, owner)


@router.post("/words/retest", response_model=RetestRound)
def start_retest(body: StartRetest, db: Session = Depends(get_db), owner: str = Depends(get_client_id),
                 timezone: str = Depends(get_timezone)) -> RetestRound:
    try:
        return word_retest.begin(db, owner, body, timezone)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.patch("/words/retest/{retest_id}/items/{position}", response_model=RetestRound)
def rate_retest(retest_id: str, position: int, body: RetestRating, db: Session = Depends(get_db),
                owner: str = Depends(get_client_id), timezone: str = Depends(get_timezone)) -> RetestRound:
    try:
        return word_retest.rate(db, owner, retest_id, position, body.rating, timezone)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.patch("/words/topics", response_model=list[Word])
def update_topic_group(payload: WordTopicChange, response: Response, db: Session = Depends(get_db),
                       owner: str = Depends(get_client_id)) -> list[Word]:
    response.headers["Cache-Control"] = "private, no-store"
    if not payload.source.strip():
        raise HTTPException(422, "请选择一个话题。")
    return repo.change_topic(db, owner, payload.source.strip(), (payload.target or "").strip() or None)


@router.post("/words/{word_id}/translation", response_model=WordTranslationGrade)
async def check_translation(word_id: int, payload: WordTranslation, response: Response,
                            db: Session = Depends(get_db), owner: str = Depends(get_optional_client_id),
                            client: DeepSeekClient = Depends(get_client)) -> WordTranslationGrade:
    response.headers["Cache-Control"] = "private, no-store"
    if not owner:
        raise HTTPException(400, "A device identifier or login is required")
    word = repo.get_word(db, owner, word_id)
    if word is None:
        raise HTTPException(404, "Word not found")
    meaning, reference, answer = word.meaning.strip(), word.text, payload.answer.strip()
    db.rollback()  # Release the read transaction before waiting on DeepSeek.
    if not meaning or not answer:
        raise HTTPException(422, "缺少中文题面或英文作答。")
    try:
        return await repo.grade_translation(meaning[:1200], reference, answer, client)
    except (DeepSeekError, ValidationError, JSONDecodeError) as exc:
        raise HTTPException(503, "暂时无法检查改写，可以查看参考后自行判断。") from exc


@router.post("/words/{word_id}/review", response_model=Word)
def review_word(
    word_id: int,
    payload: WordReview,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
    timezone: str = Depends(get_timezone),
) -> Word:
    try:
        return Word.model_validate(repo.review_word_by_id(
            db, client_id, word_id, payload.remembered, timezone,
            payload.client_request_id, uncertain=payload.uncertain, created_at=payload.created_at,
        ))
    except repo.WordChanged as exc:
        raise HTTPException(status_code=409, detail={"code": "word_changed", "message": str(exc)}) from exc
    except RequestConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Word not found") from exc


@router.patch("/words/{word_id}", response_model=Word)
def update_word(
    word_id: int,
    payload: WordUpdate,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> Word:
    entry = repo.get_word(db, client_id, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    try:
        return Word.model_validate(repo.update_word(db, entry, payload.model_dump(exclude_unset=True)))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Word not found") from exc


@router.delete("/words/{word_id}", status_code=204)
def remove_word(
    word_id: int, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> None:
    entry = repo.get_word(db, client_id, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    try:
        repo.delete_word(db, entry)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Word not found") from exc
