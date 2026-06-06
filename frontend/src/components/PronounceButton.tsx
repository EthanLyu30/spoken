import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { postPronunciation, type PronunciationResult } from "../lib/api";

function scoreColor(s: number): string {
  if (s >= 85) return "#2fa274"; // green
  if (s >= 70) return "#e07f1c"; // amber
  return "#e6503d"; // red
}

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
        setResult(await postPronunciation(text, pcm));
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
      {result && (
        <div className="mt-2 rounded-2xl bg-surface px-3 py-2 shadow-soft">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className="font-display text-lg font-bold tabnum"
              style={{ color: scoreColor(result.overall) }}
            >
              {Math.round(result.overall)}
            </span>
            <span className="text-[0.6rem] font-bold uppercase text-muted">发音分 / 100</span>
            <span className="text-[0.62rem] text-muted">
              准确 {Math.round(result.accuracy)} · 流利 {Math.round(result.fluency)} · 完整{" "}
              {Math.round(result.integrity)}
            </span>
          </div>
          {result.words.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-1.5">
              {result.words.map((w, i) => (
                <span
                  key={i}
                  className="text-sm font-semibold"
                  style={{ color: scoreColor(w.score) }}
                  title={`${Math.round(w.score)}`}
                >
                  {w.word}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
