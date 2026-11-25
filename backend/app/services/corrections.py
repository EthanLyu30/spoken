"""Ground sentence corrections and count recurring patterns across sessions."""

from collections import defaultdict
import logging
import re

from pydantic import ValidationError

from app.schemas.chat import ChatMessage
from app.schemas.feedback import Correction, CorrectionFocus

logger = logging.getLogger(__name__)


def read_corrections(stored, session_id: int | None = None) -> list[Correction]:
    """Read legacy JSON without letting invalid entries hide valid corrections."""
    corrections = []
    rejected = 0
    if isinstance(stored, list):
        for item in stored:
            try:
                corrections.append(Correction.model_validate(item))
            except ValidationError:
                rejected += 1
    elif stored is not None:
        rejected = 1
    if rejected and session_id is not None:
        logger.warning("Ignored %d invalid corrections in practice session %d", rejected, session_id)
    return corrections

def correction_key(correction: Correction) -> tuple[int | None, str | None, str]:
    return (correction.turn_index, "saved" if correction.self_marked else correction.category,
            correction.original.strip().casefold())


def ground_corrections(corrections: list[Correction], messages: list[ChatMessage]) -> list[Correction]:
    kept = {}
    for correction in corrections:
        original = correction.original.strip().casefold()
        if not original:
            continue
        index = correction.turn_index
        if correction.self_marked:
            suggestion = correction.suggestion.strip()
            if (correction.marked and index is not None and 0 <= index < len(messages)
                    and len(suggestion) <= 600
                    and messages[index].role == "user" and original == messages[index].content.strip().casefold()):
                key = correction_key(correction)
                if key not in kept or not kept[key].suggestion:
                    kept[key] = Correction(
                        original=messages[index].content, suggestion=suggestion, note="", turn_index=index,
                        marked=True, self_marked=True,
                    )
            continue
        # A categorized empty replacement deletes the quoted text. Blank
        # uncategorized entries and whitespace-only suggestions are unusable.
        if not correction.suggestion.strip() and (correction.category is None or correction.suggestion != ""):
            continue
        if index is not None or correction.category is not None or correction.marked:
            if index is None or index >= len(messages) or messages[index].role != "user":
                continue
            line = messages[index].content.casefold()
            if original not in line:
                continue
            if correction.suggestion == "" and not re.search(rf"(?<!\w){re.escape(original)}(?!\w)", line):
                continue
        key = correction_key(correction)
        if key not in kept or correction.marked and not kept[key].marked:
            kept[key] = correction
    return list(kept.values())


def merge_scored_corrections(incoming: list[Correction], previous: list[Correction],
                             messages: list[ChatMessage]) -> list[Correction]:
    # The latest saved choices win over marks captured in the original report request.
    saved = {correction_key(fix): fix for fix in ground_corrections(previous, messages)}
    merged = []
    for fix in ground_corrections(incoming, messages):
        existing = saved.pop(correction_key(fix), None)
        if existing and existing.self_marked and existing.suggestion:
            merged.append(existing)
        else:
            merged.append(fix.model_copy(update={"marked": existing.marked}) if existing else fix)
    return [*merged, *saved.values()]


def merge_sentence_favorites(incoming: list[Correction], stored: list[dict],
                             messages: list[ChatMessage]) -> list[dict]:
    favorites = {correction_key(fix): fix for fix in ground_corrections(
        [fix for fix in incoming if fix.self_marked], messages,
    )}
    if not favorites:
        return stored

    merged = []
    for item in stored if isinstance(stored, list) else []:
        entries = read_corrections([item])
        if entries and entries[0].self_marked and entries[0].marked:
            existing = entries[0]
            favorite = favorites.pop(correction_key(existing), None)
            if favorite and favorite.suggestion and not existing.suggestion.strip():
                item = favorite.model_dump()
        merged.append(item)
    return [*merged, *(favorite.model_dump() for favorite in favorites.values())]


def repeated_focus(snapshots, catalogue_ids: set[str]) -> list[CorrectionFocus]:
    """Count distinct learner turns per category in each saved session."""
    by_category = defaultdict(list)
    for scenario_id, corrections in snapshots:
        distinct_turns = defaultdict(set)
        for correction in read_corrections(corrections):
            if not correction.self_marked and correction.category is not None and correction.turn_index is not None:
                distinct_turns[correction.category].add(correction.turn_index)
        for category, indexes in distinct_turns.items():
            by_category[category].append((scenario_id, len(indexes)))

    patterns = [
        CorrectionFocus(
            category=category, sessions=len(sessions), turns=sum(count for _, count in sessions),
            scenario_id=next((scene for scene, _ in sessions if scene in catalogue_ids), "cafe"),
        )
        for category, sessions in by_category.items() if len(sessions) >= 2
    ]
    return sorted(patterns, key=lambda item: (
        item.category == "word_choice", -item.sessions, -item.turns, item.category,
    ))[:3]
