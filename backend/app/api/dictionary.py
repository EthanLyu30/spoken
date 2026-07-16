"""On-demand English word and short-phrase definitions."""

from fastapi import APIRouter, Depends, HTTPException

from app.api.chat import get_client
from app.schemas.dictionary import DictionaryEntry, DictionaryLookupRequest
from app.services.deepseek import DeepSeekClient, DeepSeekError
from app.services.dictionary import lookup_dictionary

router = APIRouter(tags=["dictionary"])


@router.post("/dictionary/lookup", response_model=DictionaryEntry)
async def dictionary_lookup(
    request: DictionaryLookupRequest,
    client: DeepSeekClient = Depends(get_client),
) -> DictionaryEntry:
    try:
        return await lookup_dictionary(request.query, client)
    except DeepSeekError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
