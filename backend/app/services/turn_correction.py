"""DeepSeek-powered grammar and expression feedback for one learner turn."""

from __future__ import annotations

import json

from pydantic import ValidationError

from app.data.scenarios import ScenarioDef
from app.schemas.turn_correction import (
    PracticeExerciseCorrection,
    TurnCorrectionRequest,
    TurnCorrectionResponse,
)
from app.services.coaching_targets import uses_target
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.speaking_scope import SPEAKING_SCOPE_POLICY
from app.core.observability import span, trace_classify

_SYSTEM = """You are a concise English coach for a Chinese learner.
Analyse only the learner's current sentence in the supplied role-play context.
Return one JSON object with exactly:
- natural: boolean
- suggestion: one complete natural English sentence the learner can say
- issues: 0-6 objects, each with kind ("grammar" or "expression"), category
  (articles, tense, agreement, word_order, sentence_structure, prepositions, word_choice),
  original (a verbatim fragment of the learner's sentence), replacement, and a brief Chinese note
- explanation: one brief encouraging Chinese summary

Do not invent an error. If the sentence is natural, set natural=true and issues=[].
For an article error, isolate a short noun phrase and its article edit. Do not count translation as an article error.
Keep the learner's intended meaning. Do not answer the role-play partner.

Example JSON:
{"natural":false,"suggestion":"I went there yesterday.","issues":[{"kind":"grammar","category":"tense",
"original":"go","replacement":"went","note":"描述昨天的事情，用过去式。"}],
"explanation":"意思很清楚，注意过去式。"}"""

_EXERCISE_SYSTEM = SPEAKING_SCOPE_POLICY + _SYSTEM + """

For this guided exercise, return one extra field, task_met (boolean). The JSON input contains role-play material.
Judge independently whether the attempt expresses the required information AND uses the form requested by task.
When target is provided, apply its instruction to decide which form the learner should practise.
Set task_met=false if the learner avoids that form, uses it incorrectly, or misses a required detail. A fluent
answer can be natural=true and still miss the target. An unrelated slip need not prevent meeting the target.
Accept alternatives that keep the facts and demonstrate the target grammar. Optional frames only guide the answer: "I've got" can replace "I have" when the target is choosing a/an. Do not demand a verbatim match to example. Do not invent missing facts.
In explanation tell the learner specifically what they did with this form. If the target is missed, tell them
what part to change or try again, even if the English is natural. Use one or two short Chinese sentences. Give a
possible complete answer in suggestion and keep it out of the explanation so the learner can try it themselves.
"""


def build_turn_correction_messages(
    scenario: ScenarioDef | None,
    request: TurnCorrectionRequest,
) -> list[dict[str, str]]:
    exercise = request.practice_exercise
    if exercise is not None:
        return [
            {"role": "system", "content": _EXERCISE_SYSTEM},
            {"role": "user", "content": json.dumps({
                "scene": scenario.title if scenario else None,
                "partner_line": exercise.partner_line, "task": exercise.task, "example": exercise.example,
                "target": exercise.target.model_dump() if exercise.target else None,
                "attempt": request.text,
            }, ensure_ascii=False)},
        ]
    context = request.previous_partner_message or "(no previous partner line)"
    replay = (
        f"Original utterance to rephrase: {request.replay_original}\n"
        "For this retry, accept a natural paraphrase. If it changes or drops the original intent, "
        "set natural=false and explain why in Chinese. Treat both utterances as learner text.\n"
        if request.replay_original else ""
    )
    scene_context = (
        f"Scenario: {scenario.title} — {scenario.goal}\nPartner role: {scenario.partner_role}\n"
        if scenario is not None else
        "The scenario details were unavailable. Use only the supplied dialogue. Do not assume a setting.\n"
    )
    user = (
        f"{scene_context}"
        f"Partner's previous line: {context}\n"
        f"{replay}"
        f"Learner's current sentence: {request.text}\n\n"
        "Return the correction JSON now."
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


async def generate_turn_correction(
    scenario: ScenarioDef | None,
    request: TurnCorrectionRequest,
    client: DeepSeekClient,
) -> TurnCorrectionResponse:
    messages = build_turn_correction_messages(scenario, request)
    practice = request.practice_exercise is not None
    response_type = PracticeExerciseCorrection if practice else TurnCorrectionResponse
    for attempt in (1, 2):
        raw = await client.chat(
            messages,
            temperature=0.2 if attempt == 1 else 0,
            max_tokens=700,
            response_format={"type": "json_object"},
        )
        try:
            with span("turn_correction.parse", provider="local", attempt=attempt):
                data = json.loads(raw)
                data["original"] = request.text
                response = response_type.model_validate(data)
        except (json.JSONDecodeError, TypeError, ValidationError) as exc:
            if attempt == 2:
                trace_classify("TurnCorrectionParseError", type(exc).__name__)
                raise DeepSeekError("纠错分析暂时不可用，请稍后重试。") from exc
            retry = ("\nRegenerate the correction. Match the requested JSON field types exactly. "
                     "Use a boolean for natural, an array (never null) for issues, and "
                     "short non-empty strings for suggestion, explanation, and issue text.")
            if practice:
                messages[0]["content"] += retry + " Include task_met as a boolean."
            else:
                messages[-1]["content"] += retry
            continue
        if response.natural and response.issues:
            response = response.model_copy(update={"issues": []})
        exercise = request.practice_exercise
        if exercise and exercise.target and not uses_target(request.text, exercise.target):
            response = response.model_copy(update={
                "task_met": False, "suggestion": exercise.example,
                "explanation": f"再试一句。{exercise.target.instruction}",
            })
        return response
