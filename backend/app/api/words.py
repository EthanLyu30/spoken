"""Word-bag endpoints: save / list / master / delete collected words."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.chat import get_client
from app.db import get_db
from app.schemas.word import Word, WordCreate, WordUpdate
from app.services import words as repo
from app.services.deepseek import DeepSeekClient

router = APIRouter(tags=["words"])


@router.post("/words", response_model=Word, status_code=201)
async def add_word(
    payload: WordCreate,
    db: Session = Depends(get_db),
    client: DeepSeekClient = Depends(get_client),
) -> Word:
    meaning = payload.meaning.strip()
    example = payload.example.strip()
    if not meaning or not example:
        m, e = await repo.define_word(payload.text, client)
        meaning = meaning or m
        example = example or e
    entry = repo.create_word(db, payload.text.strip(), payload.scenario_id, meaning, example)
    return Word.model_validate(entry)


@router.get("/words", response_model=list[Word])
def list_words(db: Session = Depends(get_db)) -> list[Word]:
    return [Word.model_validate(w) for w in repo.list_words(db)]


@router.patch("/words/{word_id}", response_model=Word)
def update_word(
    word_id: int, payload: WordUpdate, db: Session = Depends(get_db)
) -> Word:
    entry = repo.get_word(db, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    entry.mastered = payload.mastered
    db.commit()
    db.refresh(entry)
    return Word.model_validate(entry)


@router.delete("/words/{word_id}", status_code=204)
def remove_word(word_id: int, db: Session = Depends(get_db)) -> None:
    entry = repo.get_word(db, word_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Word not found")
    repo.delete_word(db, entry)
