import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getInterviewSet: vi.fn(),
  scoreInterview: vi.fn(),
  savePractice: vi.fn(),
  startRecording: vi.fn(),
  transcribeSpeech: vi.fn(),
  createLiveTranscription: vi.fn(),
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
  mocks.createLiveTranscription.mockReturnValue({ send: vi.fn(), finish: vi.fn(), close: vi.fn() });
  mocks.speakText.mockReturnValue({ done: Promise.resolve(), stop: vi.fn() });
  mocks.savePractice.mockResolvedValue({ id: 1 });
});
afterEach(() => vi.useRealTimers());
it("scores the returned deck identity and preserves reference metadata in saved results", async () => {
  const scored = {
    overall: 4,
    score_max: 5, scoring_version: "ets-interview-text-v1", scoring_basis: "transcript",
    results: [{
      question: "Question one?", answer: "I enjoy running in the park.", score: 4,
      level: "Good", feedback: "Clear reason.", sample_answer: "I like running.",
      sample_source: "video_reference", sample_source_url: "https://www.youtube.com/watch?v=abcdefghijk",
      sample_word_count: 3, sample_estimated_seconds: 6,
    }],
  };
  mocks.scoreInterview.mockResolvedValue(scored);
  const { result } = renderHook(() => useInterviewSession("device-reference"));
  await act(async () => result.current.begin("practice"));
  for (let i = 0; i < 4; i++) {
    await act(async () => result.current.startAnswer());
    await act(async () => result.current.finishAnswer());
    await act(async () => result.current.acceptAnswer());
    if (i < 3) {
      expect(mocks.scoreInterview).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("quiz");
      expect(result.current.result).toBeNull();
    }
  }
  expect(mocks.scoreInterview).toHaveBeenCalledWith(
    deck.questions.map((question) => ({ question, answer: "I enjoy running in the park." })),
    expect.any(AbortSignal), "exercise",
  );
  expect(result.current.phase).toBe("results");
  expect(JSON.parse(mocks.savePractice.mock.calls[0][3]).results).toEqual(scored.results);
  expect(JSON.parse(mocks.savePractice.mock.calls[0][3])).toMatchObject({ score_max: 5, scoring_version: "ets-interview-text-v1", scoring_basis: "transcript" });
});
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
it("only requests the score and reference answers after all four simulation answers", async () => {
  vi.useFakeTimers();
  mocks.scoreInterview.mockResolvedValue({ overall: 4, results: [] });
  const { result } = renderHook(() => useInterviewSession("device-simulation-review"));
  await act(async () => result.current.begin("simulation", "exercise"));
  for (let i = 0; i < 4; i++) {
    await act(async () => vi.advanceTimersByTimeAsync(45_000));
    if (i < 3) {
      expect(mocks.scoreInterview).not.toHaveBeenCalled();
      expect(result.current.phase).toBe("quiz");
      expect(result.current.result).toBeNull();
    }
  }
  expect(mocks.scoreInterview).toHaveBeenCalledTimes(1);
  expect(result.current.answers).toHaveLength(4);
  expect(result.current.phase).toBe("results");
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

it("does not advance or score a simulation answer when recognition is incomplete", async () => {
  vi.useFakeTimers();
  mocks.transcribeSpeech.mockRejectedValueOnce(Object.assign(new Error("incomplete"), { name: "IncompleteTranscriptionError", partialText: "I like" }));
  const { result } = renderHook(() => useInterviewSession("incomplete-simulation"));
  await act(async () => result.current.begin("simulation", "exercise"));
  await act(async () => vi.advanceTimersByTimeAsync(45_000));
  expect(result.current.idx).toBe(0);
  expect(result.current.answers).toEqual([]);
  expect(result.current.canRetryRecognition).toBe(true);
  expect(mocks.scoreInterview).not.toHaveBeenCalled();
  await act(async () => result.current.retryRecognition());
  expect(result.current.answers).toEqual(["I enjoy running in the park."]);
  expect(result.current.idx).toBe(1);
});
it("feeds interview recording chunks into the live ASR stream", async () => {
  const live = { send: vi.fn(), finish: vi.fn(), close: vi.fn() };
  mocks.createLiveTranscription.mockReturnValueOnce(live);
  let emit: ((pcm: ArrayBuffer) => void) | undefined;
  mocks.startRecording.mockImplementation(async (onPcm) => {
    emit = onPcm;
    return { stop: vi.fn().mockResolvedValue(new ArrayBuffer(16)) };
  });
  const { result } = renderHook(() => useInterviewSession("device-live"));
  await act(async () => result.current.begin("practice", "exercise"));
  await act(async () => result.current.startAnswer());
  act(() => emit?.(new ArrayBuffer(16)));
  await act(async () => result.current.finishAnswer());
  expect(live.send).toHaveBeenCalled();
  expect(mocks.transcribeSpeech).toHaveBeenCalledWith(
    expect.any(ArrayBuffer), expect.anything(), "auto", live,
  );
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

it("does not send grading results after a synchronous credential change before React rerenders", async () => {
  const { setToken } = await import("../lib/authToken");
  setToken("interview-a");
  let scored!: (value: object) => void;
  mocks.scoreInterview.mockReturnValue(new Promise(resolve => { scored = resolve; }));
  const { result } = renderHook(() => useInterviewSession("same-account"));
  await act(async () => result.current.begin("practice"));
  for (let i = 0; i < 4; i++) {
    await act(async () => result.current.startAnswer());
    await act(async () => result.current.finishAnswer());
    if (i < 3) await act(async () => result.current.acceptAnswer());
  }
  let pending!: Promise<void>;
  act(() => { pending = result.current.acceptAnswer(); });
  setToken("interview-replacement");
  await act(async () => { scored({ overall: 4, results: [] }); await pending; });
  expect(mocks.savePractice).not.toHaveBeenCalled();
  expect(result.current.result).toBeNull();
});

it("pauses simulation after failed prompt narration until explicit text-only continuation", async () => {
  mocks.speakText.mockReturnValue({done:Promise.resolve(),failed:true,stop:vi.fn()});
  const {result}=renderHook(()=>useInterviewSession("failed-prompt"));
  await act(async()=>result.current.begin("simulation","exercise"));
  expect(mocks.startRecording).toHaveBeenCalledTimes(1); // Permission preflight only.
  expect(result.current).toMatchObject({phase:"quiz",qPhase:"ready",left:45,answers:[]});
  expect(result.current.error).toContain("朗读未能完成");
  expect(result.current.error).toContain("开始回答");
  await act(async()=>result.current.startAnswer());
  expect(mocks.startRecording).toHaveBeenCalledTimes(2);
  expect(result.current.qPhase).toBe("recording");expect(result.current.error).toBeNull();
});
it("pauses simulation on the prompt deadline without automatically recording", async () => {
  vi.useFakeTimers();const stop=vi.fn();
  mocks.speakText.mockReturnValue({done:new Promise<void>(()=>{}),failed:false,stop});
  const {result}=renderHook(()=>useInterviewSession("timed-out-prompt"));
  let pending!:Promise<void>;
  await act(async()=>{pending=result.current.begin("simulation","exercise");await Promise.resolve();await Promise.resolve();});
  expect(result.current.qPhase).toBe("listening");
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);await pending;});
  expect(stop).toHaveBeenCalledOnce();expect(mocks.startRecording).toHaveBeenCalledTimes(1);
  expect(result.current).toMatchObject({qPhase:"ready",left:45,answers:[]});
  expect(result.current.error).toContain("朗读未能完成");
  await act(async()=>vi.advanceTimersByTimeAsync(45_000));
  expect(result.current.idx).toBe(0);expect(mocks.startRecording).toHaveBeenCalledTimes(1);
  await act(async()=>result.current.startAnswer());expect(result.current.qPhase).toBe("recording");
});

it.each(["practice", "simulation"] as const)("retries a lost %s save with one receipt and no regrading", async mode => {
  if(mode === "simulation") vi.useFakeTimers();
  mocks.scoreInterview.mockResolvedValue({overall:4,results:[]});
  mocks.savePractice.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({id:1});
  const {result}=renderHook(()=>useInterviewSession("save-retry"));
  await act(async()=>result.current.begin(mode));
  for(let i=0;i<4;i++) {
    if(mode === "simulation") await act(async()=>vi.advanceTimersByTimeAsync(45_000));
    else {
      await act(async()=>result.current.startAnswer());await act(async()=>result.current.finishAnswer());await act(async()=>result.current.acceptAnswer());
    }
  }
  expect(result.current).toMatchObject({phase:"results",saveError:true,result:{overall:4}});
  await act(async()=>result.current.retrySave());
  expect(result.current.saveError).toBe(false);expect(mocks.scoreInterview).toHaveBeenCalledTimes(1);
  const key=mocks.savePractice.mock.calls[0][5];expect(key).toEqual(expect.any(String));
  expect(mocks.savePractice.mock.calls[1][5]).toBe(key);
  act(()=>result.current.exit());await act(async()=>result.current.begin("practice"));
  for(let i=0;i<4;i++) {
    await act(async()=>result.current.startAnswer());await act(async()=>result.current.finishAnswer());await act(async()=>result.current.acceptAnswer());
  }
  expect(mocks.savePractice.mock.calls[2][5]).not.toBe(key);
});

it("allows a fresh run after owner and credential replacement while discarding the old run",async()=>{
  const {setToken}=await import("../lib/authToken");setToken("owner-replacement-a");
  let finishOld!:(value:typeof deck)=>void;
  mocks.getInterviewSet.mockReturnValueOnce(new Promise(resolve=>{finishOld=resolve;})).mockResolvedValueOnce(deck);
  const {result,rerender}=renderHook(({owner})=>useInterviewSession(owner),{initialProps:{owner:"account-a"}});
  let old!:Promise<void>;act(()=>{old=result.current.begin("practice");});
  act(()=>setToken("owner-replacement-b"));rerender({owner:"account-b"});
  await act(async()=>result.current.begin("practice"));
  expect(result.current).toMatchObject({phase:"quiz",owner:"account-b",idx:0});
  await act(async()=>{finishOld({...deck,topic:"old owner"});await old;});
  expect(result.current.deck?.topic).toBe("运动");
});
