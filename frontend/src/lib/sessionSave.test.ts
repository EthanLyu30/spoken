import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postSession: vi.fn() }));
vi.mock("./api", () => ({ postSession: mocks.postSession }));
import { persistSessionOnce } from "./sessionSave";
import type { FeedbackResponse } from "./api";

const feedback = { overall: 80, summary: "Good", tip: "Keep going", scores: [] } as unknown as FeedbackResponse;
const messages = [{ role: "user" as const, content: "A latte please." }];
beforeEach(() => { mocks.postSession.mockReset().mockResolvedValue({}); });

it("saves independent practices even when the transcript, length and score match", async () => {
  await persistSessionOnce("cafe", messages, feedback, "independent-a");
  await persistSessionOnce("cafe", messages, feedback, "independent-b");
  expect(mocks.postSession.mock.calls.map(([payload]) => payload.client_session_id)).toEqual(["independent-a", "independent-b"]);
});

it("sends one request for simultaneous saves of the same practice", async () => {
  let complete: () => void = () => {};
  mocks.postSession.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
  const a = persistSessionOnce("cafe", messages, feedback, "concurrent-practice");
  const b = persistSessionOnce("cafe", messages, feedback, "concurrent-practice");
  complete();
  await Promise.all([a, b]);
  expect(mocks.postSession).toHaveBeenCalledTimes(1);
});

it("allows a failed save to be retried with the same idempotency key", async () => {
  mocks.postSession.mockRejectedValueOnce(new Error("offline"));
  await expect(persistSessionOnce("cafe", messages, feedback, "retry-practice")).rejects.toThrow("offline");
  await persistSessionOnce("cafe", messages, feedback, "retry-practice");
  expect(mocks.postSession).toHaveBeenCalledTimes(2);
});

it("does not send a follow-on save captured under an earlier identity", async () => {
  const { setToken, getAuthGeneration } = await import("./authToken");
  setToken("session-a"); const generation = getAuthGeneration(); setToken("session-b");
  await persistSessionOnce("cafe", messages, feedback, "stale-save", generation);
  expect(mocks.postSession).not.toHaveBeenCalled();
});
