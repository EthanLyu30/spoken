"""Timed Q&A (TOEFL-style independent speaking) — questions + scoring.

The client runs a 45s-per-question drill, transcribes each spoken answer via
ASR, then sends the transcripts here for an ETS-style rating and sample answers.
"""

import json
import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.data.interview_questions import INDEPENDENT_QUESTIONS
from app.schemas.interview import (
    InterviewQuestions,
    InterviewResult,
    InterviewScoreRequest,
    InterviewScoreResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["interview"])

_SCENARIO_SYSTEM = """You are a TOEFL iBT speaking coach. Generate ONE fresh TOEFL-style INDEPENDENT speaking question grounded in a realistic, everyday scenario (study, work, travel, technology, relationships, daily life).

It must match the real TOEFL independent format (state and defend an opinion / preference / agree-or-disagree), be one or two clear sentences, and be answerable in about 45 seconds.

Return ONLY JSON: {"questions": ["..."]}."""

_SCORE_SYSTEM = """You are an experienced TOEFL iBT speaking rater. You receive TOEFL-style independent speaking questions and a test-taker's spoken answer (auto-transcribed from speech, so ignore minor transcription noise and missing punctuation).

Rate each answer like an ETS independent speaking task, judging delivery, language use, and topic development.

For EACH item return an object with:
- "question": echo the question.
- "answer": echo the transcript (may be empty).
- "score": integer 0-6 (TOEFL-style band for this single answer; 6 = excellent, 0 = no/irrelevant answer).
- "level": one of "Good", "Fair", "Limited", "Weak".
- "feedback": 2-3 sentences in Chinese covering delivery / language / development, ending with one concrete, actionable tip.
- "sample_answer": a natural, high-scoring (band 6) sample answer in English, about 100-130 words (~45 seconds spoken), directly answering the question.

Return ONLY JSON: {"overall": <number 0-6, the average of the scores>, "results": [ ... in the same order as the input ]}."""


async def _ai_scenario_question(client: DeepSeekClient) -> str | None:
    """One fresh scenario-grounded question, or None if generation fails."""
    messages = [
        {"role": "system", "content": _SCENARIO_SYSTEM},
        {"role": "user", "content": "Give me one question for today."},
    ]
    try:
        raw = await client.chat(
            messages, temperature=0.95, max_tokens=120, response_format={"type": "json_object"}
        )
        items = [q for q in json.loads(raw).get("questions", []) if isinstance(q, str) and q.strip()]
        return items[0].strip() if items else None
    except (DeepSeekError, json.JSONDecodeError, ValueError, TypeError, KeyError):
        return None


@router.get("/interview/questions", response_model=InterviewQuestions)
async def interview_questions(
    n: int = 4,
    ai: bool = True,
    client: DeepSeekClient = Depends(get_client),
) -> InterviewQuestions:
    """Real TOEFL questions from the bank, blended with one AI scenario question.

    Always succeeds (the bank is the fallback), so the drill never blocks on the
    model being unavailable.
    """
    n = max(1, min(n, 6))
    pool = random.sample(INDEPENDENT_QUESTIONS, min(len(INDEPENDENT_QUESTIONS), n + 2))

    if not ai:
        return InterviewQuestions(questions=pool[:n])

    questions = pool[: max(0, n - 1)]
    extra = await _ai_scenario_question(client)
    if extra and extra not in questions:
        questions.append(extra)
    # Top up from the bank if AI was unavailable or produced a duplicate.
    for q in pool:
        if len(questions) >= n:
            break
        if q not in questions:
            questions.append(q)
    return InterviewQuestions(questions=questions[:n])


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
        if not results:
            raise ValueError("no results")
        overall = data.get("overall")
        if not isinstance(overall, (int, float)):
            overall = sum(r.score for r in results) / len(results)
        overall = round(max(0.0, min(6.0, float(overall))), 1)
        return InterviewScoreResponse(overall=overall, results=results)
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not score answers") from exc
