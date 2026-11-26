"""Schemas for the word bag."""

from datetime import datetime
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.data.scenarios import get_scenario
from app.schemas.session import SessionScene


class WordSource(BaseModel):
    key: str = Field(pattern=r"^(?:[a-z0-9_-]{1,64}|custom-[0-9a-f]{64})$")
    title: str = Field(default="", max_length=80)
    previous_partner_message: str = Field(default="", max_length=800)


class WordCreate(BaseModel):
    text: str = Field(min_length=1, max_length=600)
    scenario_id: str = ""
    meaning: str = ""
    example: str = ""
    kind: str = "word"  # word | phrase | sentence
    topic: str | None = Field(default=None, max_length=48)
    source: WordSource | None = None
    custom_scene: SessionScene | None = None
    previous_partner_message: str = Field(default="", max_length=800)

    @model_validator(mode="after")
    def keep_source_snapshot(self):
        previous = self.previous_partner_message.strip()
        if self.custom_scene is not None:
            if self.scenario_id != "custom" or self.source is not None:
                raise ValueError("A custom scene must have a single source")
            custom = self.custom_scene
            self.source = WordSource(key=f"custom-{custom.identity()}",
                                     title=custom.title_zh.strip() or custom.title.strip(),
                                     previous_partner_message=previous)
        elif self.source is not None:
            key = self.source.key
            if self.scenario_id == "custom":
                valid = re.fullmatch(r"custom-[0-9a-f]{64}", key) and self.source.title.strip()
            else:
                valid = (key == "daily" and not self.scenario_id) or (key == self.scenario_id and get_scenario(key) is not None)
            if not valid or previous:
                raise ValueError("Word source does not match the collection context")
        elif previous and get_scenario(self.scenario_id) is not None:
            self.source = WordSource(key=self.scenario_id, previous_partner_message=previous)
        return self


class WordUpdate(BaseModel):
    mastered: bool | None = None
    topic: str | None = Field(default=None, max_length=48)


class WordTopicChange(BaseModel):
    source: str = Field(min_length=1, max_length=48)
    target: str | None = Field(max_length=48)


class WordTranslation(BaseModel):
    answer: str = Field(min_length=1, max_length=1200)
    created_at: str | None = Field(default=None, min_length=1, max_length=40)


class WordTranslationPromptRequest(BaseModel):
    created_at: str = Field(min_length=1, max_length=40)


class WordTranslationPrompt(BaseModel):
    translation: str | None = Field(max_length=1200)


class WordTranslationGrade(BaseModel):
    verdict: Literal["equivalent", "partial", "different"]
    feedback: str = Field(min_length=1, max_length=160)


class WordReview(BaseModel):
    remembered: bool
    uncertain: bool = False
    client_request_id: str | None = Field(default=None, min_length=1, max_length=80)
    # Echo the canonical timestamp from the card, without dropping precision.
    created_at: str | None = Field(default=None, min_length=1, max_length=40)


class Word(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    text: str
    meaning: str
    review_translation: str | None = None
    example: str
    scenario_id: str
    source: WordSource | None = None
    topic: str | None = None
    familiarity: Literal["familiar", "uncertain", "forgot"] | None = None
    kind: str
    mastered: bool
    created_at: datetime
    box: int = 0
    due_at: datetime | None = None
    last_reviewed: datetime | None = None
