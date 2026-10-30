"""Calibration gates must fail on drift, weak discrimination or incomplete runs."""

import copy
import json
from pathlib import Path

import pytest

from scripts.calibrate_interview import summarize


CASES = [
    {"id": "weak", "expected": [0, 0], "ladder": "demo", "band": 0},
    {"id": "strong", "expected": [4, 5], "ladder": "demo", "band": 5},
]
ROWS = [{"id": item, "repeat": repeat, "score": score} for repeat in range(1, 4) for item, score in [("weak", 0), ("strong", 5)]]


def test_complete_stable_calibration_passes():
    report = summarize(CASES, ROWS, 3)
    assert report["passed"] is True
    assert report["range_hit_rate"] == 1
    assert report["max_spread"] == 0
    assert report["observations"] == 6


def test_drift_is_not_hidden_by_good_mean_or_interval_hits():
    rows = copy.deepcopy(ROWS)
    rows[1]["score"] = 3
    report = summarize(CASES, rows, 3)
    assert not report["passed"]
    assert report["max_spread"] == 2


@pytest.mark.parametrize("rows", [ROWS[:-1], ROWS + [ROWS[0]], [{**row, "repeat": 1} for row in ROWS]])
def test_missing_or_duplicate_repeats_cannot_claim_calibration(rows):
    with pytest.raises(ValueError):
        summarize(CASES, rows, 3)


def test_inverted_anchor_order_fails_even_with_wide_expected_intervals():
    cases = [{**case, "expected": [0, 5]} for case in CASES]
    rows = [{**row, "score": 5 if row["id"] == "weak" else 0} for row in ROWS]
    assert not summarize(cases, rows, 3)["passed"]


@pytest.mark.parametrize("filename", ["interview_scoring_calibration.json", "interview_scoring_validation.json"])
def test_frozen_fixtures_cover_every_band_without_exposing_labels_to_score_items(filename):
    fixture = json.loads((Path(__file__).parent / "fixtures" / filename).read_text(encoding="utf-8"))
    cases = fixture["cases"]
    assert {case["band"] for case in cases if "band" in case} == set(range(6))
    assert len({case["id"] for case in cases}) == len(cases)
    assert all(0 <= case["expected"][0] <= case["expected"][1] <= 5 for case in cases)
