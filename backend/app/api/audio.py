"""Shared bounded PCM request-body reader for speech endpoints."""

from fastapi import HTTPException, Request

from app.services.xf_ise import MAX_AUDIO_BYTES


async def read_pcm(request: Request) -> bytes:
    """Read one nonempty PCM body without buffering beyond the hard limit."""
    pcm = bytearray()
    async for chunk in request.stream():
        if len(pcm) + len(chunk) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio body too large")
        pcm.extend(chunk)
    if not pcm:
        raise HTTPException(status_code=400, detail="Empty audio body")
    return bytes(pcm)
