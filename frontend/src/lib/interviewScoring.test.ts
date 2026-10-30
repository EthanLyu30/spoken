import { expect, it } from "vitest";
import { interviewProgressSummary, interviewScoreMax } from "./interviewScoring";

it("identifies complete new metadata and preserves old or incomplete history", () => {
  expect(interviewScoreMax({ score_max: 5, scoring_version: "ets-interview-text-v1" })).toBe(5);
  expect(interviewScoreMax({})).toBe(6);
  expect(interviewScoreMax({ score_max: 5 })).toBe(6);
});

it("does not mix old six-point scores into new five-point averages", () => {
  expect(interviewProgressSummary([
    { score: 6 }, { score: 3 }, { score: 3, score_max: 5 }, { score: 5, score_max: 5 },
  ])).toEqual({ average: 4, scale: 5, count: 2, legacyCount: 2 });
});

it("retains the old average when there are only legacy records", () => {
  expect(interviewProgressSummary([{ score: 6 }, { score: 3, score_max: 6 }]))
    .toEqual({ average: 4.5, scale: 6, count: 2, legacyCount: 2 });
  expect(interviewProgressSummary([])).toEqual({ average: null, scale: 5, count: 0, legacyCount: 0 });
});
