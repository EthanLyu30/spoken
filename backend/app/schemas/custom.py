"""Schemas for user-defined (custom) role-play scenarios.

A custom scene is generated on the fly by DeepSeek from a learner's short
description, then carried back inline on chat / feedback requests so the same
role-play and assessment code paths can run without a catalogue entry.
"""

from pydantic import BaseModel, Field


class CustomScene(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    title_zh: str = Field(default="", max_length=80)
    partner_role: str = Field(min_length=1, max_length=200)
    goal: str = Field(min_length=1, max_length=400)
    persona: str = Field(min_length=1, max_length=1200)
    opening_line: str = Field(min_length=1, max_length=400)


class CustomSceneRequest(BaseModel):
    description: str = Field(min_length=2, max_length=300)
