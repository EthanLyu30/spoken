"""Timed Take an Interview practice — questions and transcript-based feedback.

The client runs a 45s-per-question drill, transcribes each spoken answer via
ASR, then sends the transcripts here for an ETS-style rating and sample answers.
"""

import json
import random
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.data.interview_questions import get_interview_sets
from app.schemas.interview import (
    InterviewQuestions,
    InterviewResult,
    InterviewScoreRequest,
    InterviewScoreResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["interview"])

_SCORE_SYSTEM = """You are an English speaking coach providing practice feedback for Take an Interview. You receive interview questions and the learner's answer transcript, so ignore minor transcription noise and missing punctuation.

Assess relevance, language use, coherence, and development of ideas. You have no audio: do not claim to assess pronunciation, actual speaking speed, pauses, or intonation. These are practice reference scores, not official ETS scores.

For EACH item return an object with:
- "question": echo the question.
- "answer": echo the transcript (may be empty).
- "score": integer 0-6 (practice reference score; 6 = excellent, 0 = no/irrelevant answer).
- "level": one of "Good", "Fair", "Limited", "Weak".
- "feedback": 2-3 sentences in Chinese covering language, coherence, and idea development, ending with one concrete, actionable tip.
- "sample_answer": a natural, well-developed sample answer in English, about 70-100 words, directly answering the interview question.

Return ONLY JSON: {"overall": <number 0-6, the average of the scores>, "results": [ ... in the same order as the input ]}."""


@router.get("/interview/sets")
def interview_sets() -> dict:
    """Catalogue metadata only: no model call and no future questions leaked in UI."""
    return {"sets": [
        {"id": s.id, "topic": s.topic, "topic_en": s.topic_en, "intro": s.intro,
         "question_count": len(s.questions), "source_title": s.source_title,
         "source_url": s.source_url, "source_kind": s.source_kind,
         "reviewed_at": s.reviewed_at, "collection": s.collection,
         "episode": s.episode}
        for s in get_interview_sets()
    ]}


@router.get("/interview/questions", response_model=InterviewQuestions)
async def interview_questions(
    n: int = 4, ai: bool = False, set_id: str | None = None,
    source: Literal["inspire", "ets", "all"] = "inspire",
) -> InterviewQuestions:
    """Select one reviewed topic set. Legacy n/ai parameters remain accepted.

    The legacy n/ai parameters never truncate or generate part of a sourced set.
    An explicit set_id takes precedence over source for older ETS callers.
    """
    sets = get_interview_sets()
    if set_id:
        group = next((s for s in sets if s.id == set_id), None)
    else:
        pool = [s for s in sets if source == "all" or s.collection == source]
        group = random.choice(pool)
    if group is None:
        raise HTTPException(status_code=404, detail="Interview set not found")
    return InterviewQuestions(
        questions=list(group.questions), set_id=group.id,
        topic=group.topic, topic_en=group.topic_en, intro=group.intro,
        hints=list(group.hints), source_title=group.source_title,
        source_url=group.source_url, source_kind=group.source_kind,
        reviewed_at=group.reviewed_at, collection=group.collection,
        episode=group.episode,
    )


@router.post("/interview/score", response_model=InterviewScoreResponse)
async def interview_score(
    req: InterviewScoreRequest,
    client: DeepSeekClient = Depends(get_client),
) -> InterviewScoreResponse:
    body = "\n\n".join(
        f"Question {i}: {it.question}\nAnswer {i}: {it.answer or '(no answer recorded)'}"
        for i, it in enumerate(req.items, 1)
    )
    messages = [
        {"role": "system", "content": _SCORE_SYSTEM},
        {"role": "user", "content": f"{body}\n\nNow rate each answer and return the JSON."},
    ]
    try:
        raw = await client.chat(
            messages, temperature=0.3, max_tokens=2200, response_format={"type": "json_object"}
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        results = [InterviewResult(**r) for r in data.get("results", []) if isinstance(r, dict)]
        if not results or len(results) != len(req.items):
            raise ValueError("incomplete results")
        # Keep original transcripts and calculate the average deterministically.
        for result, item in zip(results, req.items):
            result.question = item.question
            result.answer = item.answer
        overall = sum(r.score for r in results) / len(results)
        overall = round(max(0.0, min(6.0, float(overall))), 1)
        return InterviewScoreResponse(overall=overall, results=results)
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not score answers") from exc
