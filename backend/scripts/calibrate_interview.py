"""Opt-in real-model calibration; calls the local scoring pipeline, never production or DB.

From backend/: python scripts/calibrate_interview.py --env-file .env --output report.json
Normal pytest does not make network calls. Fixtures are author-written, not ETS-rated.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.interview import interview_score  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.data.interview_rubric import SCORING_VERSION  # noqa: E402
from app.schemas.interview import InterviewScoreRequest  # noqa: E402
from app.services.deepseek import DeepSeekClient  # noqa: E402


def summarize(cases: list[dict], rows: list[dict], repeats: int) -> dict:
    if repeats < 3 or not cases or len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Need unique fixtures and at least three repeats")
    expected_keys = {(case["id"], repeat) for case in cases for repeat in range(1, repeats + 1)}
    keys = [(row["id"], row["repeat"]) for row in rows]
    if len(keys) != len(expected_keys) or set(keys) != expected_keys:
        raise ValueError("Missing, unknown or duplicate calibration observations")
    if any(type(row["score"]) is not int or not 0 <= row["score"] <= 5 for row in rows):
        raise ValueError("Calibration contains invalid scores")
    evaluated = []
    for case in cases:
        scores = [row["score"] for row in sorted(rows, key=lambda row: row["repeat"]) if row["id"] == case["id"]]
        low, high = case["expected"]
        evaluated.append({
            "id": case["id"], "expected": [low, high], "scores": scores,
            "mean": statistics.mean(scores), "spread": max(scores) - min(scores),
            "hits": sum(low <= score <= high for score in scores),
            "max_distance": max(max(low - score, score - high, 0) for score in scores),
        })
    by_id = {case["id"]: case for case in evaluated}
    ladders = {}
    for ladder in sorted({case["ladder"] for case in cases if "ladder" in case}):
        anchors = sorted((case for case in cases if case.get("ladder") == ladder), key=lambda case: case["band"])
        means = [by_id[case["id"]]["mean"] for case in anchors]
        ladders[ladder] = {"means": means, "ordered": means == sorted(means)}
    hit_rate = sum(case["hits"] for case in evaluated) / len(rows)
    max_spread = max(case["spread"] for case in evaluated)
    zero_correct = all(all(score == 0 for score in case["scores"]) for case in evaluated if case["expected"] == [0, 0])
    return {
        "passed": hit_rate >= 0.9 and max_spread <= 1 and zero_correct
                  and all(case["max_distance"] <= 1 for case in evaluated)
                  and all(ladder["ordered"] for ladder in ladders.values()),
        "observations": len(rows), "repeats": repeats, "range_hit_rate": hit_rate,
        "max_spread": max_spread, "zero_cases_correct": zero_correct,
        "ladders": ladders, "cases": evaluated,
    }


class CountingClient(DeepSeekClient):
    calls = 0

    async def chat(self, messages, **kwargs):
        self.calls += 1
        return await super().chat(messages, **kwargs)


async def run(args) -> dict:
    fixture_bytes = args.fixtures.read_bytes()
    fixtures = json.loads(fixture_bytes)
    cases = fixtures["cases"]
    settings = Settings(_env_file=args.env_file) if args.env_file else Settings()
    if not settings.deepseek_api_key:
        raise ValueError("Existing DEEPSEEK_API_KEY configuration is required")
    client = CountingClient(settings)
    semaphore = asyncio.Semaphore(2)
    started = time.monotonic()

    async def grade(batch: list[dict], repeat: int) -> list[dict]:
        # Rotate order to include position effects; never send expected scores to the model.
        shift = (repeat - 1) % len(batch)
        batch = batch[shift:] + batch[:shift]
        request = InterviewScoreRequest(items=[{"question": case["question"], "answer": case["answer"]} for case in batch])
        async with semaphore:
            result = await interview_score(request, client)
        if len(result.results) != len(batch) or result.score_max != 5:
            raise ValueError("Incomplete or unversioned scoring response")
        rows = [{"id": case["id"], "repeat": repeat, "score": scored.score,
                 "feedback": scored.feedback, "sample_words": scored.sample_word_count}
                for case, scored in zip(batch, result.results)]
        print(json.dumps({"repeat": repeat, "scores": [{"id": row["id"], "score": row["score"]} for row in rows]}), flush=True)
        return rows

    rows = []
    for repeat in range(1, args.repeats + 1):
        groups = await asyncio.gather(*(grade(cases[index:index + 4], repeat) for index in range(0, len(cases), 4)))
        rows.extend(row for group in groups for row in group)
    return {
        "fixture_sha256": hashlib.sha256(fixture_bytes).hexdigest(),
        "rubric_version": SCORING_VERSION, "model": settings.deepseek_model,
        "fixture_description": fixtures["description"], "source": fixtures["source"],
        "seconds": round(time.monotonic() - started, 2), "model_calls": client.calls,
        **summarize(cases, rows, args.repeats), "observed_feedback": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).resolve().parents[1] / "tests/fixtures/interview_scoring_calibration.json")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 3 <= args.repeats <= 10:
        parser.error("--repeats must be between 3 and 10")
    report = asyncio.run(run(args))
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("passed", "observations", "range_hit_rate", "max_spread", "model_calls", "seconds")}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
