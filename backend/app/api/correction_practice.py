import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.core.observability import trace_classify
from app.schemas.correction_practice import ChinesePrompt, TranslationAttempt, TranslationExercise, TranslationGrade
from app.services.correction_practice import AmbiguousTranslationPrompt, check_translation, translate
from app.services.deepseek import DeepSeekClient, DeepSeekError

router = APIRouter(prefix="/correction-practice", tags=["correction-practice"])


async def _with_deadline(work):
    try:
        async with asyncio.timeout(18):
            return await work
    except AmbiguousTranslationPrompt as exc:
        trace_classify(type(exc).__name__, exc.source)
        raise HTTPException(status_code=422, detail={
            "code": "translation_prompt_ambiguous",
            "message": "这条纠错无法仅凭中文题面区分，请改用填空练习。",
        }) from exc
    except (TimeoutError, DeepSeekError) as exc:
        raise HTTPException(status_code=503, detail="翻译练习暂时不可用，请重试。") from exc


@router.post("/translation", response_model=ChinesePrompt)
async def translation(exercise: TranslationExercise, client: DeepSeekClient = Depends(get_client)):
    return await _with_deadline(translate(exercise, client))


@router.post("/check", response_model=TranslationGrade)
async def check(exercise: TranslationAttempt, client: DeepSeekClient = Depends(get_client)):
    return await _with_deadline(check_translation(exercise, client))
