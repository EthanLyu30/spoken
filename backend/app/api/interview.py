"""Timed Take an Interview practice — questions and transcript-based feedback.

The client runs a 45s-per-question drill, transcribes each spoken answer via
ASR, then sends the transcripts here for an ETS-style rating and sample answers.
"""

import json
import random
import re
from asyncio import timeout
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from app.api.chat import get_client
from app.data.interview_questions import get_interview_sets
from app.data.interview_answer_references import load_answer_references
from app.schemas.interview import (
    InterviewQuestions,
    InterviewResult,
    InterviewScoreRequest,
    InterviewScoreResponse,
)
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(tags=["interview"])
_SCORE_BUDGET_SECONDS = 55.0

_SAMPLE_STYLE_GUIDANCE = """Expression-upgrade guidance (for sample answers, not learner scoring):
- Keep the learner's stated position and supplied details. Even a briefly supported preference is valid: improve its support without switching sides to match a video or your own opinion.
- The original video is presented separately. This version should model a better-developed answer with natural, reusable phrasing, rather than merely shorten the learner's wording or reconstruct the video's original text.
- Write for a 45-second response with thinking pauses. Target 55–75 words, never exceeding 75; usually aim for 60–70 when useful development fits. A naturally shorter complete answer is fine, but do not strip useful detail just to minimize word count, and never pad to reach a target.
- Use a flexible 3–5 spoken sentences: a clear answer, one developed reason, and one compact illustration with its immediate result. Cover every necessary question part. Do not force a fixed sentence template. Give a complete spoken answer even with an empty transcript, not an outline.
- Make the illustration an object or task plus an observable action and effect. Explain briefly how the action supports the reason. Replace vague wording with this detail; avoid a longer backstory, multiple examples, or unnecessary names, dates and numbers. For opinion or policy questions, a plausible situation or practical consequence is enough.
- Stop on the example's result. No separate wrap-up sentence, repeated preference, repeated reason, or generic claim that the approach is better.
- Reuse given experiences. Added details must be possible illustrations ("I can", "a student could"), never invented past events, friends' experiences, or claims about past performance.
- Enrich expression with precise everyday verbs, natural collocations and some sentence variety, such as a useful when, because, if or relative clause. Keep it easy to say under pressure; avoid rare idioms, ornate vocabulary, stock openings and stacked complex clauses.
Before returning, silently revise each sample once: replace a vague activity label with one useful action or detail, delete a closing sentence that repeats an earlier point, and remove invented memories. Check that all required question parts remain and the sample is at most 75 words. Put only the revised answer in sample_answer."""

_SCORE_SYSTEM = """You are an English speaking coach providing practice feedback for Take an Interview. You receive interview questions and the learner's answer transcript, so ignore minor transcription noise and missing punctuation.

Assess relevance, language use, coherence, and development of ideas. You have no audio: do not claim to assess pronunciation, actual speaking speed, pauses, or intonation. These are practice reference scores, not official ETS scores.

For EACH item return an object with:
- "question": echo the question.
- "answer": echo the transcript (may be empty).
- "score": integer 0-6 (practice reference score; 6 = excellent, 0 = no/irrelevant answer).
- "level": one of "Good", "Fair", "Limited", "Weak".
- "feedback": 2-3 sentences in Chinese covering language, coherence, and idea development, ending with one concrete, actionable tip. Keep the advice realistic for 45 seconds: suggest replacing vague wording with a useful detail rather than automatically adding another sentence.
- "sample_answer": the DeepSeek expression-upgrade version, a complete English response following the guidance below. It is AI-authored, never the video's verbatim original answer.

""" + _SAMPLE_STYLE_GUIDANCE + """

Any supplied video answer ideas are optional perspectives, not a scoring standard. A reasonable different position must not lower a score. Use video ideas only to improve the sample, preserving the learner's reasonable position and examples first. Assess only the learner's transcript; the sample does not replace their answer.

Return ONLY JSON: {"overall": <number 0-6, the average of the scores>, "results": [ ... in the same order as the input ]}."""

_REPAIR_SYSTEM = """Shorten only the supplied sample_answer values, retaining the learner's reasonable position, concrete examples, and every necessary branch of the question. Preserve the useful action or detail when compressing; remove repeated claims and generic wrap-up before cutting the example.

""" + _SAMPLE_STYLE_GUIDANCE + """

Video ideas are optional, not a scoring standard; reasonable different positions are valid. Return ONLY JSON: {"results": [{"question_index": <original one-based index>, "sample_answer": <complete revised English answer>}]}. Return exactly the requested indices. Do not grade, modify feedback, or return other fields."""


def _word_count(sample: str) -> int:
    return len(re.findall(r"[a-zA-Z0-9]+(?:['’][a-zA-Z0-9]+)*", sample))


def _reference_url(source_url: str, timestamp: str) -> str:
    seconds = 0
    for part in timestamp.split(":"):
        seconds = seconds * 60 + int(part)
    url = urlsplit(source_url)
    query = [(key, value) for key, value in parse_qsl(url.query) if key != "t"]
    query.append(("t", str(seconds)))
    return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), url.fragment))


async def _repair_samples(client: DeepSeekClient, results: list[InterviewResult], req: InterviewScoreRequest, reference) -> None:
    long_indices = [index for index, result in enumerate(results) if _word_count(result.sample_answer) > 75]
    if not long_indices:
        return
    items = [
        {"question_index": index + 1, "question": req.items[index].question,
         "learner_answer": req.items[index].answer, "sample_answer": results[index].sample_answer,
         "optional_video_ideas": reference.answers[index].notes if reference is not None else None}
        for index in long_indices
    ]
    # One bounded call repairs every long sample without asking for new grades.
    raw = await client.chat(
        [{"role": "system", "content": _REPAIR_SYSTEM}, {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)}],
        temperature=0.3, max_tokens=1800, response_format={"type": "json_object"},
    )
    data = json.loads(raw)
    repaired = data.get("results") if isinstance(data, dict) else None
    if not isinstance(repaired, list) or len(repaired) != len(long_indices):
        raise ValueError("incomplete sample repair")
    remaining = {index + 1 for index in long_indices}
    for item in repaired:
        if not isinstance(item, dict) or type(item.get("question_index")) is not int or item["question_index"] not in remaining:
            raise ValueError("misaligned sample repair")
        sample = item.get("sample_answer")
        if not isinstance(sample, str) or not 1 <= _word_count(sample) <= 75:
            raise ValueError("invalid repaired sample")
        remaining.remove(item["question_index"])
        results[item["question_index"] - 1].sample_answer = sample


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
    # Both network calls share one budget below the client's 60-second timeout.
    # Expiry cancels an in-flight call rather than leaving model work running.
    try:
        async with timeout(_SCORE_BUDGET_SECONDS):
            return await _score_interview(req, client)
    except TimeoutError as exc:
        raise HTTPException(status_code=503, detail="Interview scoring timed out; please retry") from exc


async def _score_interview(req: InterviewScoreRequest, client: DeepSeekClient) -> InterviewScoreResponse:
    sets = get_interview_sets()
    questions = tuple(item.question for item in req.items)
    if req.set_id is not None:
        group = next((group for group in sets if group.id == req.set_id), None)
        if group is None or questions != group.questions:
            raise HTTPException(status_code=422, detail="Interview set must match all questions in their original order")
    else:
        matches = [group for group in sets if group.questions == questions]
        group = matches[0] if len(matches) == 1 else None
    reference = None
    if group is not None and group.collection == "inspire":
        try:
            candidate = load_answer_references(sets=sets)[group.id]
        except (OSError, ValueError, TypeError) as exc:
            raise HTTPException(status_code=503, detail="Interview answer references are unavailable") from exc
        if candidate.status == "reviewed":
            reference = candidate
    body = "\n\n".join(
        f"Question {i}: {it.question}\nAnswer {i}: {it.answer or '(no answer recorded)'}"
        for i, it in enumerate(req.items, 1)
    )
    messages = [
        {"role": "system", "content": _SCORE_SYSTEM},
        {"role": "user", "content": f"{body}\n\nNow rate each answer and return the JSON."},
    ]
    if reference is not None:
        context = "\n".join(f"Question {idea.question_index} ({idea.timestamp}): {idea.notes}" for idea in reference.answers)
        messages.insert(1, {"role": "system", "content": f"Reviewed video answer ideas (optional, not a scoring standard):\n{context}"})
    try:
        raw = await client.chat(
            messages, temperature=0.3, max_tokens=2200, response_format={"type": "json_object"}
        )
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("results"), list):
            raise ValueError("invalid results")
        # Model-supplied provenance and timing are never trusted, even if invalid.
        trusted_fields = {"question", "answer", "score", "level", "feedback", "sample_answer"}
        results = [InterviewResult(**{k: v for k, v in r.items() if k in trusted_fields}) for r in data.get("results", []) if isinstance(r, dict)]
        if not results or len(results) != len(req.items):
            raise ValueError("incomplete results")
        await _repair_samples(client, results, req, reference)
        # Keep original transcripts and calculate the average deterministically.
        for index, (result, item) in enumerate(zip(results, req.items)):
            result.question = item.question
            result.answer = item.answer
            result.sample_source = "video_reference" if reference is not None else "ai_generated"
            result.sample_source_url = _reference_url(reference.source_url, reference.answers[index].timestamp) if reference is not None else None
            result.sample_word_count = _word_count(result.sample_answer)
            if result.sample_word_count < 1:
                raise ValueError("empty sample answer")
            result.sample_estimated_seconds = round(result.sample_word_count / 110 * 60 + 4)
        overall = sum(r.score for r in results) / len(results)
        overall = round(max(0.0, min(6.0, float(overall))), 1)
        return InterviewScoreResponse(overall=overall, results=results)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="Could not score answers") from exc
