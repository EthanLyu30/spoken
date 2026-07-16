import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { postPronunciation, savePractice, type PronunciationResult } from "../lib/api";
import { PronunciationFeedback } from "./PronunciationFeedback";

/** Read a line aloud and get an iFlytek pronunciation score with word colours. */
export function PronounceButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "recording" | "scoring">("idle");
  const [result, setResult] = useState<PronunciationResult | null>(null);
  const [err, setErr] = useState(false);
  const recRef = useRef<ActiveRecorder | null>(null);

  async function onClick() {
    if (state === "scoring") return;
    if (state === "recording") {
      const rec = recRef.current;
      recRef.current = null;
      setState("scoring");
      setErr(false);
      try {
        const pcm = await rec!.stop();
        const r = await postPronunciation(text, pcm);
        setResult(r);
        savePractice("pronunciation", r.overall, text).catch(() => undefined);
      } catch {
        setErr(true);
      } finally {
        setState("idle");
      }
    } else {
      setErr(false);
      setResult(null);
      try {
        recRef.current = await startRecording();
        setState("recording");
      } catch {
        setErr(true);
      }
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
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
    </div>
  );
}
