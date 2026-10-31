"""English voices verified against the configured online-TTS service.

An HTTP/provider success is insufficient: unsupported IDs can silently produce
the default Chinese speaker. Keep old clients working through explicit aliases.
"""

VERIFIED_ENGLISH_VOICES = frozenset({"catherine", "henry"})
_LEGACY_VOICES = frozenset({
    "x5_enus_flossie_flow", "x3_enus_emma_assist", "x4_enus_luna_formal",
    "x4_enus_laura_education", "x4_lindsey_formal",
})


def normalize_cloud_voice(voice: str) -> str:
    if voice in _LEGACY_VOICES:
        return "catherine"
    if voice not in VERIFIED_ENGLISH_VOICES:
        raise ValueError("Unsupported English cloud voice")
    return voice
