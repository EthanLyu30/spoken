from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.session import SessionScene


CueId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
English = Annotated[str, Field(min_length=1, max_length=600)]


class CueDraft(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    id: CueId | None = None
    kind: Literal["word", "phrase", "pattern"]
    keyword: English
    meaning: str = Field(default="", max_length=400)
    sentence: English


class SceneCue(CueDraft):
    id: CueId


class SceneCueSnapshot(BaseModel):
    revision: int = 0
    # None uses the current catalogue defaults. [] is a deliberately cleared list.
    cues: list[SceneCue] | None = None


class CustomCueLookup(BaseModel):
    custom: SessionScene


class CueChange(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    defaults: list[SceneCue] = Field(max_length=3)
    custom: SessionScene | None = None

    @field_validator("defaults")
    @classmethod
    def distinct_defaults(cls, cues: list[SceneCue]) -> list[SceneCue]:
        if len({cue.id for cue in cues}) != len(cues):
            raise ValueError("Default cue IDs must be distinct")
        return cues


class SaveCue(CueChange):
    action: Literal["save"]
    cue: CueDraft


class RemoveCue(CueChange):
    action: Literal["remove"]
    id: CueId


class AddHint(CueChange):
    action: Literal["add_hint"]
    sentence: English


SceneCueChange = Annotated[SaveCue | RemoveCue | AddHint, Field(discriminator="action")]
