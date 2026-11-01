"""Retired cloud read-aloud routes; recognition and scoring remain independent."""
from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["tts"])


@router.post("/tts", deprecated=True)
@router.post("/tts/stream", deprecated=True)
@router.post("/tts/prepare", deprecated=True)
async def retired_tts():
    # Old open tabs must not initiate provider audio or preparation either.
    raise HTTPException(410, "云端朗读已停用，请使用浏览器语音。", headers={"Cache-Control": "no-store"})
