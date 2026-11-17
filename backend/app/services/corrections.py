"""Ground sentence corrections and count recurring patterns across sessions."""

from collections import defaultdict
from typing import get_args

from app.schemas.chat import ChatMessage
from app.schemas.feedback import Correction, CorrectionCategory, CorrectionFocus


def ground_corrections(corrections: list[Correction], messages: list[ChatMessage]) -> list[Correction]:
    kept = {}
    for correction in corrections:
        original = correction.original.strip().casefold()
        if not original or not correction.suggestion.strip():
            continue
        index = correction.turn_index
        if index is not None or correction.category is not None or correction.marked:
            if (index is None or index >= len(messages) or messages[index].role != "user"
                    or original not in messages[index].content.casefold()):
                continue
        key = (index, correction.category, original)
        if key not in kept or correction.marked and not kept[key].marked:
            kept[key] = correction
    return list(kept.values())


def repeated_focus(snapshots, catalogue_ids: set[str]) -> list[CorrectionFocus]:
    """Count distinct learner turns per category in each saved session."""
    categories = get_args(CorrectionCategory)
    by_category = defaultdict(list)
    for scenario_id, corrections in snapshots:
        distinct_turns = defaultdict(set)
        for item in corrections or []:
            category, index = item.get("category"), item.get("turn_index")
            if category in categories and type(index) is int:
                distinct_turns[category].add(index)
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
