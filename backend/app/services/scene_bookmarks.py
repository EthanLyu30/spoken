"""The saved sentences shared by the scene list and word-bag import."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.scene_cues import ScenePreparation
from app.schemas.scene_cues import SceneCue


def sentence_key(sentence: str) -> str:
    return " ".join(sentence.casefold().split())


def saved_sentences(db: Session, owner: str):
    rows = db.scalars(select(ScenePreparation).where(ScenePreparation.client_id == owner)
                      .order_by(ScenePreparation.title, ScenePreparation.scene_key))
    for row in rows:
        sentences = [SceneCue.model_validate(cue) for cue in row.cues if not cue["id"].startswith("default-")
                     and cue["kind"] == "pattern" and sentence_key(cue["keyword"]) == sentence_key(cue["sentence"])]
        if sentences:
            yield row, sentences
