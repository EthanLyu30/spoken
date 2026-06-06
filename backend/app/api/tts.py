"""Text-to-speech endpoint: returns MP3 audio of Pip's line (iFlytek TTS)."""

from fastapi import APIRouter, Depends, HTTPException, Response

from app.data import scenarios as catalog
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
    cfg = catalog.voice_for(req.scenario_id)
    try:
        audio = await client.synthesize(
            req.text,
            vcn=str(cfg["vcn"]),
            speed=int(cfg["speed"]),  # type: ignore[arg-type]
            pitch=int(cfg["pitch"]),  # type: ignore[arg-type]
        )
    except XfTtsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg")
