"""Timed Q&A (TOEFL-style independent speaking) — questions + scoring.

The client runs a 45s-per-question drill, transcribes each spoken answer via
ASR, then sends the transcripts here for an ETS-style rating and sample answers.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.schemas.interview import (
    InterviewQuestions,
    InterviewResult,
    InterviewScoreRequest,
    InterviewScoreResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["interview"])

_QUESTIONS_SYSTEM = """You are a TOEFL iBT speaking coach. Generate {n} TOEFL-style INDEPENDENT speaking questions (the "state and defend a personal opinion / preference / agree-or-disagree" type), each answerable in about 45 seconds.

Keep each question one or two clear sentences, varied across topics (study, work, technology, lifestyle, society). Do NOT number them.

Return ONLY JSON: {{"questions": ["...", "..."]}}."""

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


@router.get("/interview/questions", response_model=InterviewQuestions)
async def interview_questions(
    n: int = 4,
    client: DeepSeekClient = Depends(get_client),
) -> InterviewQuestions:
    n = max(1, min(n, 6))
    messages = [
        {"role": "system", "content": _QUESTIONS_SYSTEM.format(n=n)},
        {"role": "user", "content": "Give me today's set of questions."},
    ]
    try:
        raw = await client.chat(
            messages, temperature=0.9, max_tokens=500, response_format={"type": "json_object"}
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        questions = [q for q in data.get("questions", []) if isinstance(q, str) and q.strip()]
        if not questions:
            raise ValueError("no questions")
        return InterviewQuestions(questions=questions[:n])
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not generate questions") from exc


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
