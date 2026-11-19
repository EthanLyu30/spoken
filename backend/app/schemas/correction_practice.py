import re

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from app.schemas.feedback import CorrectionCategory


class PracticeEdit(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    original: str = Field(min_length=1, max_length=2000)
    suggestion: str = Field(max_length=4000)
    category: CorrectionCategory | None = None


class TranslationExercise(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    original: str = Field(min_length=1, max_length=4000)
    reference: str = Field(min_length=1, max_length=4000)
    previous_partner_message: str = Field(default="", max_length=2000)
    focus: PracticeEdit


class ChinesePrompt(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    chinese: str = Field(min_length=1, max_length=2400)

    @field_validator("chinese")
    @classmethod
    def contains_chinese(cls, value: str) -> str:
        if not re.search(r"[\u3400-\u9fff]", value):
            raise ValueError("A Chinese translation is required")
        return value


class ChinesePromptDraft(BaseModel):
    chinese: str | None = Field(max_length=2400)


class ChinesePromptReview(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    meaning_preserved: StrictBool
    focus_is_clear: StrictBool
    cue_evidence: str = Field(default="", max_length=2400)
    competing_translation: str = Field(default="", max_length=2400)


class TranslationAttempt(TranslationExercise, ChinesePrompt):
    attempt: str = Field(min_length=1, max_length=4000)


class TranslationGrade(BaseModel):
    correct: bool
    feedback: str


class TranslationAssessment(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    meaning_preserved: StrictBool
    focus_correct: StrictBool
    natural: StrictBool
    feedback: str = Field(min_length=1, max_length=400)
