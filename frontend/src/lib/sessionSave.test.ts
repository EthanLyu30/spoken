import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ postSession: vi.fn() }));
vi.mock("./api", () => ({ postSession: mocks.postSession }));
import { forgetSavedSession, persistSessionOnce, syncSavedCorrections, unscoredSession } from "./sessionSave";
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

it("queues a favorite behind an in-flight checkpoint and coalesces duplicate updates", async () => {
  const favorite = { original: messages[0].content, suggestion: "May I have a latte?", note: "", turn_index: 0,
    marked: true, self_marked: true };
  const checkpoint = { ...unscoredSession([]), id: 92, created_at: "2026-11-25T08:00:00.000123" };
  let finishCheckpoint!: (result: typeof checkpoint) => void;
  mocks.postSession.mockImplementationOnce(() => new Promise(resolve => { finishCheckpoint = resolve; }))
    .mockResolvedValueOnce({ ...checkpoint, corrections: [favorite] });

  const practiceId = "pending-new-favorite";
  const old = persistSessionOnce("cafe", messages, unscoredSession([]), practiceId);
  const late = persistSessionOnce("cafe", messages, unscoredSession([favorite]), practiceId);
  const duplicate = persistSessionOnce("cafe", messages, unscoredSession([favorite]), practiceId);
  finishCheckpoint(checkpoint);
  const [, ...results] = await Promise.all([old, late, duplicate]);

  expect(results.map(result => result?.corrections)).toEqual([[favorite], [favorite]]);
  expect(mocks.postSession).toHaveBeenCalledTimes(2);
});

it("allows a failed save to be retried with the same idempotency key", async () => {
  mocks.postSession.mockRejectedValueOnce(new Error("offline"));
  await expect(persistSessionOnce("cafe", messages, feedback, "retry-practice")).rejects.toThrow("offline");
  await persistSessionOnce("cafe", messages, feedback, "retry-practice");
  expect(mocks.postSession).toHaveBeenCalledTimes(2);
});

it("does not read a deleted practice back out of the local report cache", async () => {
  const created_at = "2026-11-25T08:00:00.000123";
  mocks.postSession.mockResolvedValueOnce({ ...feedback, id: 501, created_at });
  await persistSessionOnce("cafe", messages, feedback, "local-delete-test");
  forgetSavedSession(501, "2026-11-25T08:00:00.000124");
  expect((await persistSessionOnce("cafe", messages, feedback, "local-delete-test"))?.id).toBe(501);
  forgetSavedSession(501, created_at);
  await expect(persistSessionOnce("cafe", messages, feedback, "local-delete-test")).rejects.toMatchObject({ code: "practice_record_deleted" });
  expect(mocks.postSession).toHaveBeenCalledOnce();
});

it("updates cached corrections only for the matching session creation time", async () => {
  const created_at = "2026-11-25T08:00:00.000124";
  const fix = { original: "latte", suggestion: "a latte", note: "", turn_index: 0 };
  mocks.postSession.mockResolvedValueOnce({ ...feedback, id: 502, created_at: "2026-11-25T08:00:00.000123", corrections: [fix] })
    .mockResolvedValueOnce({ ...feedback, id: 502, created_at, corrections: [fix] });
  await persistSessionOnce("cafe", messages, feedback, "older-correction-record");
  await persistSessionOnce("cafe", messages, feedback, "newer-correction-record");

  const marked = { ...fix, marked: true };
  syncSavedCorrections(502, created_at, [marked]);

  expect((await persistSessionOnce("cafe", messages, feedback, "older-correction-record"))?.corrections).toEqual([fix]);
  expect((await persistSessionOnce("cafe", messages, feedback, "newer-correction-record"))?.corrections).toEqual([marked]);
  expect(mocks.postSession).toHaveBeenCalledTimes(2);
});

it("does not send a follow-on save captured under an earlier identity", async () => {
  const { setToken, getAuthGeneration } = await import("./authToken");
  setToken("session-a"); const generation = getAuthGeneration(); setToken("session-b");
  await persistSessionOnce("cafe", messages, feedback, "stale-save", generation);
  expect(mocks.postSession).not.toHaveBeenCalled();
});
