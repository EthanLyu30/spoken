"""Pronunciation assessment endpoint: reference text + PCM -> scores (iFlytek ISE)."""

import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException, Request

from app.schemas.pronunciation import PronunciationResult
from app.services.pronunciation import parse_ise_xml
from app.services.xf_ise import XfIseClient, XfIseError

router = APIRouter(tags=["pronunciation"])


def get_ise_client() -> XfIseClient:
    """Dependency so tests can override the iFlytek client."""
    return XfIseClient()


@router.post("/pronunciation", response_model=PronunciationResult)
async def pronunciation(
    request: Request,
    text: str,
    language: str = "en",
    client: XfIseClient = Depends(get_ise_client),
) -> PronunciationResult:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Missing reference text")
    pcm = await request.body()
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty audio body")
    try:
        xml = await client.evaluate_raw(text, pcm, language=language)
    except XfIseError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        return parse_ise_xml(xml)
    except (ValueError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail="Could not parse ISE result") from exc
