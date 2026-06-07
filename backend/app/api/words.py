"""Word-bag endpoints: save / list / master / delete collected words."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.chat import get_client
from app.core.deps import get_client_id
from app.db import get_db
from app.schemas.word import Word, WordCreate, WordReview, WordUpdate
from app.services import words as repo
from app.services.deepseek import DeepSeekClient

router = APIRouter(tags=["words"])


@router.post("/words", response_model=Word, status_code=201)
async def add_word(
    payload: WordCreate,
    db: Session = Depends(get_db),
    client: DeepSeekClient = Depends(get_client),
    client_id: str = Depends(get_client_id),
) -> Word:
    text = payload.text.strip()
    # Idempotent: collecting the same text twice returns the existing entry.
    existing = repo.find_by_text(db, client_id, text)
    if existing is not None:
        return Word.model_validate(existing)

    meaning = payload.meaning.strip()
    example = payload.example.strip()
    if not meaning or not example:
        m, e = await repo.define_word(text, client)
        meaning = meaning or m
        example = example or e
    entry = repo.create_word(db, client_id, text, payload.scenario_id, meaning, example, payload.kind)
    return Word.model_validate(entry)


@router.get("/words", response_model=list[Word])
def list_words(db: Session = Depends(get_db), client_id: str = Depends(get_client_id)) -> list[Word]:
    return [Word.model_validate(w) for w in repo.list_words(db, client_id)]


@router.get("/words/due", response_model=list[Word])
def list_due_words(
    kind: str | None = None, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> list[Word]:
    return [Word.model_validate(w) for w in repo.list_due(db, client_id, kind)]


@router.post("/words/{word_id}/review", response_model=Word)
def review_word(
    word_id: int,
    payload: WordReview,
    db: Session = Depends(get_db),
    client_id: str = Depends(get_client_id),
) -> Word:
    entry = repo.get_word(db, client_id, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    return Word.model_validate(repo.review_word(db, entry, payload.remembered))


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
    entry.mastered = payload.mastered
    db.commit()
    db.refresh(entry)
    return Word.model_validate(entry)


@router.delete("/words/{word_id}", status_code=204)
def remove_word(
    word_id: int, db: Session = Depends(get_db), client_id: str = Depends(get_client_id)
) -> None:
    entry = repo.get_word(db, client_id, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    repo.delete_word(db, entry)
