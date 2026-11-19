"""Private scene preparation. Each edit is applied to the current list under the owner lock."""

import hashlib
import json
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.core.deps import get_client_id, get_optional_client_id
from app.data.scenarios import get_scenario
from app.db import get_db
from app.models.scene_cues import ScenePreparation
from app.schemas.scene_cues import (
    AddHint, CustomCueLookup, RemoveCue, SceneCue, SceneCueChange, SceneCueSnapshot,
)
from app.schemas.session import SessionScene

router = APIRouter(prefix="/scene-cues", tags=["scene preparation"])


def _scene(scenario_id: str, custom: SessionScene | None = None) -> tuple[str, str]:
    if scenario_id == "custom":
        if custom is None:
            raise HTTPException(422, "Missing custom scene")
        # Include generated exercises and their targets. SessionScene restores optional defaults
        # when an older stored lesson is reopened. The source label is purely presentational.
        identity = custom.model_dump(exclude={"source"})
        canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        key = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        return f"custom-{key}", custom.title_zh or custom.title
    scene = get_scenario(scenario_id)
    if scene is None:
        raise HTTPException(404, "Unknown scene")
    return scene.id, scene.title_zh or scene.title


def _reader(owner: str = Depends(get_optional_client_id)) -> str:
    # The custom lookup carries scene content in a POST body and still performs a read.
    if not owner:
        raise HTTPException(400, "A device identifier or login is required")
    return owner


def _snapshot(row: ScenePreparation | None, response: Response) -> SceneCueSnapshot:
    response.headers["Cache-Control"] = "private, no-store"
    return SceneCueSnapshot(revision=row.revision, cues=row.cues) if row is not None else SceneCueSnapshot()


@router.get("/{scenario_id}")
def read(scenario_id: str, response: Response, owner: str = Depends(_reader),
         db: Session = Depends(get_db)) -> SceneCueSnapshot:
    key, _ = _scene(scenario_id)
    return _snapshot(db.get(ScenePreparation, (owner, key)), response)


@router.post("/custom/lookup")
def read_custom(body: CustomCueLookup, response: Response, owner: str = Depends(_reader),
                db: Session = Depends(get_db)) -> SceneCueSnapshot:
    key, _ = _scene("custom", body.custom)
    return _snapshot(db.get(ScenePreparation, (owner, key)), response)


def _sentence_key(sentence: str) -> str:
    return " ".join(sentence.casefold().split())


def _edit(items: list[SceneCue], change: SceneCueChange) -> list[SceneCue]:
    if isinstance(change, RemoveCue):
        return [item for item in items if item.id != change.id]
    if isinstance(change, AddHint):
        line = _sentence_key(change.sentence)
        if any(_sentence_key(item.sentence) == line for item in items):
            return items
        return [*items, SceneCue(id=uuid4().hex, kind="pattern", keyword=change.sentence, sentence=change.sentence)]

    draft = change.cue
    fields = draft.model_dump(exclude={"id"})
    if draft.id is None:
        # Retrying an add after a lost response must not append a second copy.
        if any(item.model_dump(exclude={"id"}) == fields for item in items):
            return items
        return [*items, SceneCue(id=uuid4().hex, **fields)]
    for index, item in enumerate(items):
        if item.id == draft.id:
            return [*items[:index], SceneCue(id=item.id, **fields), *items[index + 1:]]
    raise HTTPException(409, "这条预习表达已删除，请刷新后重试。")


@router.patch("/{scenario_id}")
def change(scenario_id: str, body: SceneCueChange, response: Response, owner: str = Depends(get_client_id),
           db: Session = Depends(get_db)) -> SceneCueSnapshot:
    key, title = _scene(scenario_id, body.custom)
    # get_client_id locks writes with the same owner lock used by sign-up and erasure.
    row = db.get(ScenePreparation, (owner, key))
    current = body.defaults if row is None else [SceneCue.model_validate(cue) for cue in row.cues]
    updated = _edit(current, body)
    if updated != current:
        if row is None:
            row = ScenePreparation(client_id=owner, scene_key=key, title=title, revision=0)
            db.add(row)
        row.cues = [item.model_dump() for item in updated]
        row.revision += 1
    db.commit()
    return _snapshot(row, response)
