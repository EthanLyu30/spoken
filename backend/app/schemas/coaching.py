from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.schemas.custom import CustomScene
from app.schemas.feedback import Correction, CorrectionCategory


class CoachingExample(BaseModel):
    session_id: int
    turn_index: int
    scenario_id: str
    original: str
    previous_partner_message: str = ""
    corrections: list[Correction]


class CoachingPattern(BaseModel):
    kind: CorrectionCategory | Literal["article_missing", "article_choice", "article_extra"]
    category: CorrectionCategory
    sessions: int
    sentences: int
    occurrences: int


class CoachingSnapshot(BaseModel):
    revision: str
    examples: list[CoachingExample]
    patterns: list[CoachingPattern]
    can_generate_plan: bool = False
    plan_examples: list[CoachingExample] = Field(default_factory=list, exclude=True)


GrammarKind = CorrectionCategory | Literal[
    "article_missing", "article_choice", "article_extra", "past_simple", "present_perfect",
    "verb_object_collocation", "verb_object_structure", "embedded_question", "reason",
    "time_preposition", "fixed_preposition",
]


class GrammarGroup(BaseModel):
    kind: GrammarKind
    occurrences: int
    sentences: int
    examples: list[CoachingExample]


class GrammarStatistics(BaseModel):
    sessions_analyzed: int
    session_limit: int
    example_limit: int
    groups: list[GrammarGroup]
    unattributed_corrections: int = 0


class PracticeTarget(BaseModel):
    model_config = ConfigDict(frozen=True)

    kind: Literal["past", "perfect", "indefinite", "article_sound", "definite", "bare_plural",
                  "bare_mass", "agreement", "embedded_question", "reason", "time_preposition",
                  "fixed_preposition", "expression"]
    instruction: str = Field(min_length=1, max_length=120)
    form: str = Field(default="", max_length=80)
    context: str = Field(default="", max_length=40)


class PracticeExerciseDraft(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    partner_line: str = Field(min_length=1, max_length=240)
    task: str = Field(min_length=1, max_length=180)
    hint: str | None = Field(default=None, min_length=1, max_length=120)
    example: str = Field(min_length=1, max_length=260)
    target: PracticeTarget | None = None


class PracticeExercise(PracticeExerciseDraft):
    hint: str = Field(min_length=1, max_length=120)


class CoachingScene(CustomScene):
    practice_exercises: list[PracticeExercise] = Field(min_length=2, max_length=2)


class CoachingSceneDraft(CustomScene):
    practice_exercises: list[PracticeExerciseDraft] = Field(min_length=2, max_length=2)


class CoachingPlanDraft(BaseModel):
    evidence: list[int] = Field(min_length=1, max_length=3)
    scene: CoachingSceneDraft


class CoachingTurnReview(BaseModel):
    answers_question: StrictBool
    fulfills_task: StrictBool
    timeline_consistent: StrictBool


class CoachingReview(BaseModel):
    problem: Literal["ready", "focus", "task", "revealed", "goal"]
    exercise: Literal[1, 2] | None = None
    turns: tuple[CoachingTurnReview, CoachingTurnReview]


class CoachingPlan(BaseModel):
    revision: str
    focus: CoachingPattern
    summary: str
    evidence: list[CoachingExample]
    scene: CoachingScene
