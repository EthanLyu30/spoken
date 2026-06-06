"""Parse iFlytek ISE evaluation XML into structured scores (0-100)."""

from __future__ import annotations

import xml.etree.ElementTree as ET

from app.schemas.pronunciation import PhonemeScore, PronunciationResult, WordScore

# iFlytek English scores are on a 0-5 scale; surface them as 0-100.
_SCALE = 20.0
_FILLER = {"sil", "fil", "silv"}


def _to100(value: str | None) -> float:
    try:
        return round(min(100.0, max(0.0, float(value or 0) * _SCALE)), 1)
    except (TypeError, ValueError):
        return 0.0


def parse_ise_xml(xml: str) -> PronunciationResult:
    root = ET.fromstring(xml)

    overall = None
    for el in root.iter():
        if "total_score" in el.attrib and "accuracy_score" in el.attrib:
            overall = el
            break
    if overall is None:
        raise ValueError("no scored element in ISE result")

    words: list[WordScore] = []
    for w in root.iter("word"):
        ts = w.attrib.get("total_score")
        content = (w.attrib.get("content") or "").strip()
        if ts is None or not content or content in _FILLER:
            continue
        phonemes: list[PhonemeScore] = []
        for ph in w.iter("phone"):
            label = (ph.attrib.get("content") or "").strip()
            if not label or label in _FILLER:
                continue
            phonemes.append(PhonemeScore(label=label, ok=ph.attrib.get("dp_message", "0") == "0"))
        words.append(WordScore(word=content, score=_to100(ts), phonemes=phonemes))

    a = overall.attrib
    return PronunciationResult(
        overall=_to100(a.get("total_score")),
        accuracy=_to100(a.get("accuracy_score")),
        fluency=_to100(a.get("fluency_score")),
        integrity=_to100(a.get("integrity_score")),
        standard=_to100(a.get("standard_score")),
        words=words,
    )
