import { useEffect, useRef, useState } from "react";
import {
  getInterviewSet,
  savePractice,
  scoreInterview,
  type InterviewDeck,
  type InterviewSource,
  type InterviewScore,
} from "../lib/api";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { transcribeSpeech } from "../lib/transcribe";
import { speakText, stopSpeaking } from "../lib/speech";

export type InterviewMode = "practice" | "simulation";
type Phase = "intro" | "loading" | "quiz" | "scoring" | "results" | "error";
type QPhase =
  | "ready"
  | "listening"
  | "starting"
  | "recording"
  | "transcribing"
  | "review";
interface State {
  owner: string;
  mode: InterviewMode;
  phase: Phase;
  qPhase: QPhase;
  deck: InterviewDeck | null;
  idx: number;
  answers: string[];
  draft: string;
  left: number;
  result: InterviewScore | null;
  error: string | null;
  canRetryRecognition: boolean;
  saveError: boolean;
  saving: boolean;
}
const initial = (owner: string): State => ({
  owner,
  mode: "practice",
  phase: "intro",
  qPhase: "ready",
  deck: null,
  idx: 0,
  answers: [],
  draft: "",
  left: 45,
  result: null,
  error: null,
  canRetryRecognition: false,
  saveError: false,
  saving: false,
});

/** All asynchronous work belongs to a run and an identity, including mic grants. */
export function useInterviewSession(owner: string) {
  const [state, setState] = useState<State>(() => initial(owner));
  const stateRef = useRef(state);
  stateRef.current = state;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const version = useRef(0);
  const recorder = useRef<ActiveRecorder | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const pcm = useRef<ArrayBuffer | null>(null);
  const playbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = (run: number) =>
    version.current === run && ownerRef.current === owner;
  const update = (patch: Partial<State>) =>
    setState((previous) =>
      previous.owner === owner ? { ...previous, ...patch } : previous,
    );
  function clearTimer() {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
  }
  function cleanup() {
    version.current++;
    clearTimer();
    controller.current?.abort();
    controller.current = null;
    if (playbackTimer.current) clearTimeout(playbackTimer.current);
    playbackTimer.current = null;
    stopSpeaking();
    const rec = recorder.current;
    recorder.current = null;
    void rec?.stop().catch(() => undefined);
    locked.current = false;
    pcm.current = null;
  }
  useEffect(() => {
    setState(initial(owner));
    return cleanup;
    // Every resource is stored in a stable ref; a new identity gets a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  async function enterQuestion(
    deck: InterviewDeck,
    idx: number,
    answers: string[],
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run)) return;
    locked.current = false;
    pcm.current = null;
    update({
      idx,
      answers,
      draft: "",
      left: 45,
      error: null,
      canRetryRecognition: false,
      qPhase: mode === "simulation" ? "listening" : "ready",
    });
    if (mode === "simulation") {
      const speech = speakText(deck.questions[idx]);
      await Promise.race([
        speech.done,
        new Promise<void>((resolve) => {
          playbackTimer.current = setTimeout(resolve, 20_000);
        }),
      ]);
      if (playbackTimer.current) clearTimeout(playbackTimer.current);
      playbackTimer.current = null;
      if (!active(run)) return;
      speech.stop();
      await record(deck, idx, answers, mode, run);
    }
  }
  async function begin(
    mode: InterviewMode,
    setId?: string,
    source: InterviewSource = "inspire",
  ) {
    if (locked.current || stateRef.current.phase !== "intro") return;
    cleanup();
    const run = version.current;
    locked.current = true;
    controller.current = new AbortController();
    update({ mode, phase: "loading", error: null, answers: [], result: null });
    try {
      if (mode === "simulation") {
        const warmup = await startRecording();
        await warmup.stop();
        if (!active(run)) return;
      }
      const deck = await getInterviewSet(setId, controller.current.signal, source);
      if (!active(run)) return;
      if (deck.questions.length !== 4) throw new Error("Incomplete set");
      update({ deck, phase: "quiz" });
      await enterQuestion(deck, 0, [], mode, run);
    } catch {
      if (active(run)) {
        locked.current = false;
        update({
          phase: "intro",
          error: "暂时无法开始。请检查网络；模拟模式还需要允许麦克风权限。",
        });
      }
    }
  }
  async function record(
    deck: InterviewDeck,
    idx: number,
    answers: string[],
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run) || locked.current) return;
    locked.current = true;
    stopSpeaking();
    update({ qPhase: "starting", error: null, canRetryRecognition: false });
    pcm.current = null;
    try {
      const rec = await startRecording();
      if (!active(run)) {
        await rec.stop();
        return;
      }
      recorder.current = rec;
      locked.current = false;
      update({ qPhase: "recording", left: 45 });
      const deadline = Date.now() + 45_000;
      clearTimer();
      interval.current = setInterval(() => {
        if (!active(run)) return;
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        update({ left });
        if (left === 0) void finish(deck, idx, answers, mode, run);
      }, 200);
    } catch {
      if (active(run)) {
        locked.current = false;
        update({
          qPhase: "ready",
          error: "无法使用麦克风。请允许权限后重新开始本题；本题尚未计分。",
        });
      }
    }
  }
  async function startAnswer() {
    const s = stateRef.current;
    if (
      !s.deck ||
      s.phase !== "quiz" ||
      !["ready", "review"].includes(s.qPhase)
    )
      return;
    await record(s.deck, s.idx, s.answers, s.mode, version.current);
  }
  async function finish(
    deck: InterviewDeck,
    idx: number,
    answers: string[],
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run) || locked.current || !recorder.current) return;
    locked.current = true;
    clearTimer();
    const rec = recorder.current;
    recorder.current = null;
    update({ qPhase: "transcribing" });
    try {
      const audio = await rec.stop();
      if (!active(run)) return;
      pcm.current = audio;
      await recognize(deck, idx, answers, mode, run);
    } catch {
      if (active(run)) {
        locked.current = false;
        update({ qPhase: "ready", error: "录音未能完成，请重新录制本题。" });
      }
    }
  }
  async function recognize(
    deck: InterviewDeck,
    idx: number,
    answers: string[],
    mode: InterviewMode,
    run: number,
  ) {
    if (!pcm.current || !active(run)) return;
    locked.current = true;
    update({ qPhase: "transcribing", error: null });
    try {
      const text = (
        await transcribeSpeech(pcm.current, controller.current?.signal)
      ).trim();
      if (!active(run)) return;
      if (!text) throw new Error("empty");
      locked.current = false;
      if (mode === "practice")
        update({ draft: text, qPhase: "review", canRetryRecognition: false });
      else await accept(deck, idx, answers, text, mode, run);
    } catch {
      if (active(run)) {
        locked.current = false;
        update({
          qPhase: "ready",
          canRetryRecognition: true,
          error:
            "这次识别未完成，录音仍保留着。可以重新识别或重录，本题尚未计分。",
        });
      }
    }
  }
  async function accept(
    deck: InterviewDeck,
    idx: number,
    answers: string[],
    text: string,
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run) || locked.current) return;
    if (!text.trim()) {
      update({ error: "请先确认本题回答。" });
      return;
    }
    const next = [...answers, text.trim().slice(0, 4000)];
    update({ answers: next });
    if (idx + 1 < deck.questions.length)
      await enterQuestion(deck, idx + 1, next, mode, run);
    else await score(deck, next, mode, run);
  }
  async function persist(
    result: InterviewScore,
    deck: InterviewDeck,
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run)) return;
    update({ saving: true });
    try {
      // request() snapshots the current identity synchronously. Once sent, this
      // write must survive route changes; only the answer/ASR work is aborted.
      await savePractice(
        "interview",
        result.overall,
        deck.topic + " · " + (mode === "practice" ? "练习" : "模拟"),
        JSON.stringify({
          ...result,
          mode,
          topic: deck.topic,
          source_title: deck.source_title,
          source_url: deck.source_url,
        }),
      );
      if (active(run)) update({ saveError: false });
    } catch {
      if (active(run)) update({ saveError: true });
    } finally {
      if (active(run)) update({ saving: false });
    }
  }
  async function score(
    deck: InterviewDeck,
    answers: string[],
    mode: InterviewMode,
    run: number,
  ) {
    if (!active(run) || locked.current) return;
    locked.current = true;
    update({ phase: "scoring", error: null });
    try {
      const result = await scoreInterview(
        deck.questions.map((question, i) => ({
          question,
          answer: answers[i] ?? "",
        })),
        controller.current?.signal,
      );
      if (!active(run)) return;
      locked.current = false;
      update({ result, phase: "results" });
      await persist(result, deck, mode, run);
    } catch {
      if (active(run)) {
        locked.current = false;
        update({
          phase: "error",
          error: "反馈暂时未能生成。四题回答仍在，可以直接重试评分。",
        });
      }
    }
  }
  function exit() {
    cleanup();
    setState(initial(owner));
  }
  return {
    ...(state.owner === owner ? state : initial(owner)),
    begin,
    startAnswer,
    exit,
    setDraft: (draft: string) => update({ draft }),
    finishAnswer: async () => {
      const s = stateRef.current;
      if (s.deck)
        await finish(s.deck, s.idx, s.answers, s.mode, version.current);
    },
    acceptAnswer: async () => {
      const s = stateRef.current;
      if (s.deck && s.qPhase === "review")
        await accept(
          s.deck,
          s.idx,
          s.answers,
          s.draft,
          s.mode,
          version.current,
        );
    },
    retryRecognition: async () => {
      const s = stateRef.current;
      if (s.deck && s.canRetryRecognition && !locked.current)
        await recognize(s.deck, s.idx, s.answers, s.mode, version.current);
    },
    retryScore: async () => {
      const s = stateRef.current;
      if (s.deck && s.phase === "error")
        await score(s.deck, s.answers, s.mode, version.current);
    },
    retrySave: async () => {
      const s = stateRef.current;
      if (s.result && s.deck && !s.saving)
        await persist(s.result, s.deck, s.mode, version.current);
    },
  };
}
