import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getInterviewSet: vi.fn(),
  scoreInterview: vi.fn(),
  savePractice: vi.fn(),
  startRecording: vi.fn(),
  transcribeSpeech: vi.fn(),
  speakText: vi.fn(),
  stopSpeaking: vi.fn(),
}));
vi.mock("../lib/api", () => mocks);
vi.mock("../lib/recorder", () => mocks);
vi.mock("../lib/transcribe", () => mocks);
vi.mock("../lib/speech", () => mocks);
import { useInterviewSession } from "./useInterviewSession";
const deck = {
  set_id: "exercise",
  topic: "运动",
  topic_en: "Exercise",
  intro: "Study",
  questions: [
    "Question one?",
    "Question two?",
    "Question three?",
    "Question four?",
  ],
  hints: ["Idea"],
  source_title: "ETS adapted",
  source_url: "https://www.ets.org/example",
  source_kind: "official_adapted",
  reviewed_at: "2026-10-28",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getInterviewSet.mockResolvedValue(deck);
  mocks.startRecording.mockResolvedValue({
    stop: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
  });
  mocks.transcribeSpeech.mockResolvedValue("I enjoy running in the park.");
  mocks.speakText.mockReturnValue({ done: Promise.resolve(), stop: vi.fn() });
  mocks.savePractice.mockResolvedValue({ id: 1 });
});
afterEach(() => vi.useRealTimers());
it("leaves preparation and transcript confirmation under the learner's control in practice mode", async () => {
  const { result } = renderHook(() => useInterviewSession("device-a"));
  await act(async () => result.current.begin("practice", "exercise"));
  expect(result.current.qPhase).toBe("ready");
  expect(mocks.startRecording).not.toHaveBeenCalled();
  await act(async () => result.current.startAnswer());
  await act(async () => result.current.finishAnswer());
  expect(result.current.qPhase).toBe("review");
  expect(result.current.idx).toBe(0);
  await act(async () => result.current.acceptAnswer());
  expect(result.current.idx).toBe(1);
  expect(result.current.answers[0]).toContain("running");
});
it("automatically starts and advances timed questions in simulation mode", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useInterviewSession("device-a"));
  await act(async () => result.current.begin("simulation", "exercise"));
  expect(result.current.qPhase).toBe("recording");
  await act(async () => vi.advanceTimersByTimeAsync(45_000));
  expect(result.current.idx).toBe(1);
  expect(result.current.qPhase).toBe("recording");
  expect(mocks.speakText).toHaveBeenCalledWith("Question two?");
});
it("draws practice and simulation from the requested source and defaults to Inspire", async () => {
  const { result } = renderHook(() => useInterviewSession("device-source"));
  await act(async () => result.current.begin("practice"));
  expect(mocks.getInterviewSet).toHaveBeenLastCalledWith(undefined, expect.any(AbortSignal), "inspire");
  act(() => result.current.exit());
  await act(async () => result.current.begin("practice", "ets-1", "ets"));
  expect(mocks.getInterviewSet).toHaveBeenLastCalledWith("ets-1", expect.any(AbortSignal), "ets");
  act(() => result.current.exit());
  await act(async () => result.current.begin("simulation", undefined, "ets"));
  expect(mocks.getInterviewSet).toHaveBeenLastCalledWith(undefined, expect.any(AbortSignal), "ets");
});
it("stops a late microphone grant after the learner has exited", async () => {
  let resolve!: (value: { stop: ReturnType<typeof vi.fn> }) => void;
  mocks.startRecording.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const stop = vi.fn().mockResolvedValue(new ArrayBuffer(16));
  const { result } = renderHook(() => useInterviewSession("device-a"));
  await act(async () => result.current.begin("practice", "exercise"));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.startAnswer();
  });
  act(() => result.current.exit());
  await act(async () => {
    resolve({ stop });
    await pending;
  });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(result.current.phase).toBe("intro");
});
it("keeps recorded audio for retry when recognition fails", async () => {
  mocks.transcribeSpeech
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("Recovered answer.");
  const { result } = renderHook(() => useInterviewSession("device-a"));
  await act(async () => result.current.begin("practice", "exercise"));
  await act(async () => result.current.startAnswer());
  await act(async () => result.current.finishAnswer());
  expect(result.current.canRetryRecognition).toBe(true);
  await act(async () => result.current.retryRecognition());
  expect(result.current.draft).toBe("Recovered answer.");
  expect(mocks.startRecording).toHaveBeenCalledTimes(1);
});
it("discards old-owner asynchronous results after switching accounts", async () => {
  let resolve!: (value: typeof deck) => void;
  mocks.getInterviewSet.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result, rerender } = renderHook(
    ({ owner }) => useInterviewSession(owner),
    { initialProps: { owner: "account-a" } },
  );
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.begin("practice", "exercise");
  });
  rerender({ owner: "account-b" });
  await act(async () => {
    resolve(deck);
    await pending;
  });
  await waitFor(() => expect(result.current.phase).toBe("intro"));
  expect(result.current.deck).toBeNull();
  expect(mocks.savePractice).not.toHaveBeenCalled();
});

it("does not cancel a save already sent under the correct identity when leaving results", async () => {
  mocks.scoreInterview.mockResolvedValue({ overall: 4, results: [] });
  let saved!: () => void;
  mocks.savePractice.mockReturnValue(
    new Promise<void>((resolve) => {
      saved = resolve;
    }),
  );
  const { result } = renderHook(() => useInterviewSession("account-save"));
  await act(async () => result.current.begin("practice", "exercise"));
  for (let i = 0; i < 4; i++) {
    await act(async () => result.current.startAnswer());
    await act(async () => result.current.finishAnswer());
    if (i < 3) await act(async () => result.current.acceptAnswer());
  }
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.acceptAnswer();
  });
  await waitFor(() => expect(result.current.phase).toBe("results"));
  const signal = mocks.savePractice.mock.calls[0][4] as AbortSignal | undefined;
  act(() => result.current.exit());
  expect(signal?.aborted).not.toBe(true);
  await act(async () => {
    saved();
    await pending;
  });
});
