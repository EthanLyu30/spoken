import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { postPronunciation, savePractice, type PronunciationResult } from "../lib/api";
import { PronunciationFeedback } from "./PronunciationFeedback";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { createPracticeId } from "../lib/sessionSave";

interface RecordingOperation {
  generation: number;
  controller: AbortController;
  recorder: ActiveRecorder | null;
}

/** Read a line aloud and get an iFlytek pronunciation score with word colours. */
export function PronounceButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "starting" | "recording" | "scoring">("idle");
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [err, setErr] = useState(false);
  const operationRef = useRef<RecordingOperation | null>(null);
  const saveRef = useRef<{generation:number; key:string; score:number; text:string; pending:boolean} | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function cancel() {
      const operation = operationRef.current;
      operationRef.current = null;
      saveRef.current = null;
      operation?.controller.abort();
      // stop() releases the stream/context; a pending grant is released below.
      void operation?.recorder?.stop().catch(() => undefined);
    }
    const unsubscribe = subscribeAuthGeneration(() => {
      cancel();
      setState("idle");
      setResult(null);
      setErr(false);
      setSaveError(false);
      setSaving(false);
    });
    return () => { unsubscribe(); cancel(); };
  }, []);

  function isCurrent(operation: RecordingOperation) {
    return operationRef.current === operation &&
      operation.generation === getAuthGeneration() && !operation.controller.signal.aborted;
  }

  async function persist() {
    const save = saveRef.current;
    if (!save || save.pending || save.generation !== getAuthGeneration()) return;
    save.pending = true;
    setSaving(true);
    setSaveError(false);
    const current = () => saveRef.current === save && save.generation === getAuthGeneration();
    try {
      // Keep the dispatched write alive when navigation cancels recording.
      await savePractice("pronunciation", save.score, save.text, "", undefined, save.key);
    } catch {
      if (current()) setSaveError(true);
    } finally {
      if (current()) {save.pending=false;setSaving(false);}
    }
  }

  async function onClick() {
    const operation = operationRef.current;
    if (operation) {
      const rec = operation.recorder;
      // No second grant/stop while either asynchronous step is pending.
      if (!rec || !isCurrent(operation)) return;
      operation.recorder = null;
      setState("scoring");
      setErr(false);
      try {
        const pcm = await rec.stop();
        if (!isCurrent(operation)) return;
        const r = await postPronunciation(text, pcm, operation.controller.signal);
        if (!isCurrent(operation)) return;
        setResult(r);
        // Once dispatched, a valid save survives navigation or identity changes.
        saveRef.current = {generation:operation.generation,key:createPracticeId(),score:r.overall,text,pending:false};
        void persist();
      } catch {
        if (isCurrent(operation)) setErr(true);
      } finally {
        if (isCurrent(operation)) {
          operationRef.current = null;
          setState("idle");
        }
      }
    } else {
      const next: RecordingOperation = {
        generation: getAuthGeneration(), controller: new AbortController(), recorder: null,
      };
      operationRef.current = next;
      setState("starting");
      setErr(false);
      setResult(null);
      saveRef.current = null;
      setSaveError(false);
      try {
        const rec = await startRecording();
        if (!isCurrent(next)) {
          await rec.stop();
          return;
        }
        next.recorder = rec;
        setState("recording");
      } catch {
        if (isCurrent(next)) {
          operationRef.current = null;
          setErr(true);
          setState("idle");
        }
      }
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={state === "starting" || state === "scoring" || saving || saveError}
        className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
      >
        {state === "scoring" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "recording" ? (
          <Square className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
        {state === "recording" ? "停止评分" : state === "scoring" ? "评分中…" : "跟读评分"}
      </button>
      {err && <span className="ml-2 text-[0.66rem] font-semibold text-[#e6503d]">评测失败，重试</span>}
      {result && <PronunciationFeedback result={result} title="跟读评分" />}
      {saving && <p role="status">正在保存评分…</p>}
      {saveError && <div><p role="alert">评分尚未确认保存，请重试。</p><button type="button" onClick={() => void persist()}>重试保存</button></div>}
    </div>
  );
}
