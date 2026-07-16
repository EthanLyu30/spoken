"""DeepSeek-backed dictionary lookup with a bounded in-process cache."""

from __future__ import annotations

import json
import time
from collections import OrderedDict

from pydantic import ValidationError

from app.schemas.dictionary import DictionaryEntry
from app.services.deepseek import DeepSeekClient, DeepSeekError

_CACHE_MAX = 512
_CACHE_TTL_SECONDS = 24 * 60 * 60
_CACHE: OrderedDict[str, tuple[float, DictionaryEntry]] = OrderedDict()

_SYSTEM = """Define one English word or short phrase for a Chinese learner.
Return one JSON object with exactly:
- phonetic: IPA for a single word, or "" when a phrase has no useful single IPA
- part_of_speech: a short English label, or "" when not applicable
- meaning: concise Chinese meaning
- example: one short natural English example
- example_zh: Chinese translation of that example
Use the requested sense most likely in everyday conversation."""


def _now() -> float:
    return time.monotonic()


def clear_dictionary_cache() -> None:
    _CACHE.clear()


async def lookup_dictionary(
    query: str,
    client: DeepSeekClient,
) -> DictionaryEntry:
    key = query.casefold()
    cached = _CACHE.get(key)
    now = _now()
    if cached is not None:
        expires_at, entry = cached
        if expires_at > now:
            _CACHE.move_to_end(key)
            return entry
        del _CACHE[key]

    raw = await client.chat(
        [
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": f"Word or phrase: {query}"},
        ],
        temperature=0.2,
        max_tokens=350,
        response_format={"type": "json_object"},
    )
    try:
        data = json.loads(raw)
        data["query"] = query
        entry = DictionaryEntry(**data)
    except (json.JSONDecodeError, TypeError, ValidationError) as exc:
        raise DeepSeekError(
            f"could not parse dictionary entry: {exc}"
        ) from exc

    _CACHE[key] = (now + _CACHE_TTL_SECONDS, entry)
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return entry
