"""Text-to-speech endpoint: returns MP3 audio of Pip's line (iFlytek TTS)."""

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse

from app.data import scenarios as catalog
from app.schemas.tts import TtsRequest
from app.services.xf_tts import XfTtsClient, XfTtsError, pcm16_to_wav, smooth_silences

router = APIRouter(tags=["tts"])


def get_tts_client() -> XfTtsClient:
    """Dependency so tests can override the iFlytek client."""
    return XfTtsClient()


@router.post("/tts")
async def tts(
    req: TtsRequest, client: XfTtsClient = Depends(get_tts_client)
) -> Response:
    cfg = catalog.voice_for(req.scenario_id)
    # User overrides win; otherwise use the scenario's tuned voice.
    vcn = req.vcn or str(cfg["vcn"])
    speed = req.speed if req.speed is not None else int(cfg["speed"])  # type: ignore[arg-type]
    pitch = req.pitch if req.pitch is not None else int(cfg["pitch"])  # type: ignore[arg-type]
    try:
        # Synthesize as raw PCM and wrap once as WAV -> gapless, continuous
        # playback (concatenated MP3 frames sound choppy / syllable-by-syllable).
        pcm = await client.synthesize(
            req.text,
            vcn=vcn,
            speed=speed,
            pitch=pitch,
            aue="raw",
        )
    except XfTtsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    # Collapse the engine's over-long inter-word gaps so speech sounds connected.
    return Response(content=pcm16_to_wav(smooth_silences(pcm)), media_type="audio/wav")


@router.post("/tts/stream")
async def tts_stream(req: TtsRequest, client: XfTtsClient = Depends(get_tts_client)) -> StreamingResponse:
    """Relay 16 kHz signed little-endian PCM as soon as each frame arrives."""
    cfg = catalog.voice_for(req.scenario_id)
    stream = client.synthesize_stream(
        req.text, vcn=req.vcn or str(cfg["vcn"]), aue="raw",
        speed=req.speed if req.speed is not None else int(cfg["speed"]),
        pitch=req.pitch if req.pitch is not None else int(cfg["pitch"]),
    )
    try:
        # Validate configuration/upstream startup before sending HTTP 200.
        first = await anext(stream)
    except (XfTtsError, StopAsyncIteration) as exc:
        await stream.aclose()
        raise HTTPException(status_code=503, detail="语音暂不可用，请稍后重试。") from exc

    async def frames():
        try:
            yield first
            async for chunk in stream:
                yield chunk
        finally:
            await stream.aclose()

    return StreamingResponse(frames(), media_type="audio/pcm", headers={
        "X-Accel-Buffering": "no", "Cache-Control": "no-store",
        "X-Audio-Sample-Rate": "16000",
    })
