import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { postPronunciation, savePractice, type PronunciationResult } from "../lib/api";
import { createPronunciationStream, type PronunciationStream } from "../lib/pronunciationStream";
import { PronunciationFeedback } from "./PronunciationFeedback";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { createPracticeId } from "../lib/sessionSave";
import { MAX_AUDIO_BYTES, MAX_RECORDING_MS } from "../lib/audioLimits";
import { bindInteraction, getInteraction, newInteractionId, reportTiming } from "../lib/telemetry";

interface RecordingOperation {
  generation: number;
  text: string;
  controller: AbortController;
  recorder: ActiveRecorder | null;
  stream: PronunciationStream | null;
  timer: ReturnType<typeof setTimeout> | null;
  bytes: number;
  stopRequestedAt?: number;
  stopReported?: boolean;
}

/** Stream captured PCM to iFlytek while keeping a complete clip for compatibility. */
export function PronounceButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "scoring">("idle");
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const operationRef = useRef<RecordingOperation | null>(null);
  const textRef = useRef(text); textRef.current = text;
  const saveRef = useRef<{ generation: number; key: string; score: number; text: string; pending: boolean } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  function reportStop(operation: RecordingOperation, outcome: "ok" | "error" | "cancelled", transport?: "relay" | "buffered") {
    if (operation.stopRequestedAt === undefined || operation.stopReported) return;
    operation.stopReported = true;
    reportTiming("pronunciation.stop_to_result", performance.now() - operation.stopRequestedAt, {
      engine: "xfyun", transport, interactionId: getInteraction(operation.controller.signal),
      entry: "follow_read", audio_bytes: operation.bytes, outcome,
    });
  }

  useEffect(() => {
    function cancel() {
      const operation = operationRef.current;
      if (operation) reportStop(operation, "cancelled");
      operationRef.current = null; saveRef.current = null;
      if (operation?.timer) clearTimeout(operation.timer);
      operation?.controller.abort(); operation?.stream?.close();
      void operation?.recorder?.stop().catch(() => undefined);
    }
    function reset() {
      cancel(); setState("idle"); setResult(null); setErr(null); setSaveError(false); setSaving(false);
    }
    reset();
    const unsubscribe = subscribeAuthGeneration(reset);
    return () => { unsubscribe(); cancel(); };
  }, [text]);

  function isCurrent(operation: RecordingOperation) {
    return operationRef.current === operation && textRef.current === operation.text &&
      operation.generation === getAuthGeneration() && !operation.controller.signal.aborted;
  }
  function fail(operation: RecordingOperation, error?: unknown) {
    if (!isCurrent(operation)) { reportStop(operation, "cancelled"); return; }
    reportStop(operation, "error");
    operationRef.current = null;
    if (operation.timer) clearTimeout(operation.timer);
    operation.controller.abort(); operation.stream?.close();
    void operation.recorder?.stop().catch(() => undefined); operation.recorder = null;
    setState("idle");
    setErr(error instanceof Error && error.message.includes("180") ? "录音最长180秒，请缩短后重试。" : "评测失败，重试");
  }
  async function persist() {
    const save = saveRef.current;
    if (!save || save.pending || save.generation !== getAuthGeneration()) return;
    save.pending = true; setSaving(true); setSaveError(false);
    const current = () => saveRef.current === save && save.generation === getAuthGeneration() && textRef.current === save.text;
    try {
      const reference = Array.from(save.text);
      const title = reference.slice(0, 200).join("");
      const detail = reference.length > 200 ? JSON.stringify({ reference_text: save.text }) : "";
      // A write dispatched under its original identity survives route changes.
      await savePractice("pronunciation", save.score, title, detail, undefined, save.key);
    } catch { if (current()) setSaveError(true); }
    finally { if (current()) { save.pending = false; setSaving(false); } }
  }
  async function finish(operation: RecordingOperation) {
    const rec = operation.recorder;
    if (!rec || !isCurrent(operation)) return;
    operation.recorder = null;
    operation.stopRequestedAt = performance.now();
    if (operation.timer) clearTimeout(operation.timer);
    setState("scoring"); setErr(null);
    try {
      const pcm = await rec.stop();
      if (!isCurrent(operation)) return;
      if (!pcm.byteLength) throw new Error("Empty audio");
      const streamed = operation.stream ? await operation.stream.finish() : null;
      if (!isCurrent(operation)) return;
      // A never-ready session has sent no PCM to an active provider session.
      const scored = streamed ?? await postPronunciation(operation.text, pcm, operation.controller.signal, "follow_read");
      if (!isCurrent(operation)) return;
      reportStop(operation, "ok", streamed ? "relay" : "buffered");
      setResult(scored);
      saveRef.current = { generation: operation.generation, key: createPracticeId(), score: scored.overall, text: operation.text, pending: false };
      void persist();
      operationRef.current = null; operation.stream?.close(); setState("idle");
    } catch (error) { fail(operation, error); }
  }
  async function onClick() {
    const active = operationRef.current;
    if (active) { await finish(active); return; }
    const operation: RecordingOperation = { generation: getAuthGeneration(), text, controller: new AbortController(), recorder: null, stream: null, timer: null, bytes: 0 };
    bindInteraction(operation.controller.signal, newInteractionId());
    operationRef.current = operation; saveRef.current = null;
    setState("starting"); setErr(null); setResult(null); setSaveError(false);
    try {
      const rec = await startRecording(pcm => {
        if (!isCurrent(operation)) return;
        operation.bytes += pcm.byteLength;
        if (operation.bytes > MAX_AUDIO_BYTES) { fail(operation, new Error("180 seconds")); return; }
        // The first audio callback can only arrive after microphone permission.
        operation.stream ??= createPronunciationStream(operation.text, operation.controller.signal, error => fail(operation, error));
        operation.stream.send(pcm);
      }, operation.controller.signal);
      if (!isCurrent(operation)) { await rec.stop(); return; }
      operation.recorder = rec; setState("recording");
      // Reaching the limit is a visible cancellation, never an unbounded mic.
      operation.timer = setTimeout(() => fail(operation, new Error("180 seconds")), MAX_RECORDING_MS);
    } catch (error) { fail(operation, error); }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={state === "starting" || state === "scoring" || saving || saveError}
        className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
      >
        {state === "scoring" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "recording" ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        {state === "recording" ? "停止评分" : state === "scoring" ? "评分中…" : "跟读评分"}
      </button>
      {err && <span className="ml-2 text-[0.66rem] font-semibold text-[#e6503d]">{err}</span>}
      {result && <PronunciationFeedback result={result} title="跟读评分" />}
      {saving && <p role="status">正在保存评分…</p>}
      {saveError && <div><p role="alert">评分尚未确认保存，请重试。</p><button type="button" onClick={() => void persist()}>重试保存</button></div>}
    </div>
  );
}
