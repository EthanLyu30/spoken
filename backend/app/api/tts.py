"""Text-to-speech endpoint: returns MP3 audio of Pip's line (iFlytek TTS)."""

from fastapi import APIRouter, Depends, HTTPException, Response

from app.schemas.tts import TtsRequest
from app.services.xf_tts import XfTtsClient, XfTtsError

router = APIRouter(tags=["tts"])


def get_tts_client() -> XfTtsClient:
    """Dependency so tests can override the iFlytek client."""
    return XfTtsClient()


@router.post("/tts")
async def tts(
    req: TtsRequest, client: XfTtsClient = Depends(get_tts_client)
) -> Response:
    try:
        audio = await client.synthesize(req.text)
    except XfTtsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg")
