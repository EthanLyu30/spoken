import { expect, it } from "vitest";
import { matchesReviewAnswer } from "./wordReview";

it("sends question versus non-question punctuation to grading in either direction", () => {
  expect(matchesReviewAnswer("You are coming？", "You are coming.")).toBe(false);
  expect(matchesReviewAnswer("You are coming?!", "You are coming.")).toBe(false);
  expect(matchesReviewAnswer("You are coming.", "You are coming?")).toBe(false);
  expect(matchesReviewAnswer("You are coming", "You are coming?")).toBe(false);
  expect(matchesReviewAnswer("Could you open the door", "Could you open the door?")).toBe(false);
  expect(matchesReviewAnswer("Could you open the door？", "Could you open the door?")).toBe(true);
});
