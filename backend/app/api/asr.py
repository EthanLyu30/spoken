"""Speech-to-text endpoint: 16 kHz mono PCM in, transcript out (iFlytek IAT)."""

from fastapi import APIRouter, Depends, HTTPException, Request

from app.services.xf_asr import XfAsrClient, XfAsrError

router = APIRouter(tags=["asr"])


def get_asr_client() -> XfAsrClient:
    """Dependency so tests can override the iFlytek client."""
    return XfAsrClient()


@router.post("/asr")
async def asr(
    request: Request,
    language: str = "en_us",
    client: XfAsrClient = Depends(get_asr_client),
) -> dict:
    pcm = await request.body()
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty audio body")
    try:
        text = await client.transcribe(pcm, language=language)
    except XfAsrError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"text": text}
