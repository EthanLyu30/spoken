import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Sparkles, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { PronounceButton } from "../components/PronounceButton";
import { fetchTtsUrl, getDailyLines, getWords, postWord, type DailyLine } from "../lib/api";
import { quotes } from "../data/quotes";

const SET_SIZE = 5;

let sharedAudio: HTMLAudioElement | null = null;
let sharedUrl: string | null = null;
async function speak(text: string) {
  try {
    const url = await fetchTtsUrl(text);
    if (!sharedAudio) sharedAudio = new Audio();
    sharedAudio.pause();
    if (sharedUrl) URL.revokeObjectURL(sharedUrl);
    sharedUrl = url;
    sharedAudio.src = url;
    await sharedAudio.play();
  } catch {
    /* ignore */
  }
}

/** Day-of-year, so the starting window rotates once per day. */
function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

/** A wrap-around slice of `n` items starting at `start`. */
function rotateWindow<T>(arr: T[], start: number, n: number): T[] {
  const len = arr.length;
  return Array.from({ length: Math.min(n, len) }, (_, i) => arr[(((start + i) % len) + len) % len]);
}

export default function Daily() {
  // `page` cycles the curated pool; null `aiLines` means show the curated set.
  const [page, setPage] = useState(0);
  const [aiLines, setAiLines] = useState<DailyLine[] | null>(null);
  const [genState, setGenState] = useState<"idle" | "loading" | "error">("idle");
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const base = dayOfYear() * SET_SIZE;
  const curated = useMemo(
    () => rotateWindow(quotes, base + page * SET_SIZE, SET_SIZE),
    [base, page],
  );
  const lines = aiLines ?? curated;
  const fromAi = aiLines !== null;

  useEffect(() => {
    const ctrl = new AbortController();
    getWords(ctrl.signal)
      .then((ws) => setSaved(new Set(ws.map((w) => w.text))))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  function save(q: DailyLine) {
    if (saved.has(q.text)) return;
    setSaved((s) => new Set(s).add(q.text));
    postWord({ text: q.text, meaning: `${q.zh} —— ${q.author}`, kind: "sentence" }).catch(() =>
      setSaved((s) => {
        const n = new Set(s);
        n.delete(q.text);
        return n;
      }),
    );
  }

  function shuffle() {
    setAiLines(null);
    setPage((p) => p + 1);
  }

  async function generate() {
    if (genState === "loading") return;
    setGenState("loading");
    try {
      const fresh = await getDailyLines(SET_SIZE);
      setAiLines(fresh);
      setGenState("idle");
    } catch {
      setGenState("error");
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <div className="mb-5">
          <p className="eyebrow">Daily lines · 每日金句</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">今日五句</h1>
          <p className="mt-1 text-sm text-muted">
            每天为你轮换一小组 · 听一遍、跟读打分、收进生词本。
          </p>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={shuffle}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5 active:translate-y-0.5"
          >
            <RefreshCw className="h-4 w-4" /> 换一批
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={genState === "loading"}
            className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5 disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {genState === "loading" ? "生成中…" : "AI 生成新句"}
          </button>
          <span className="text-xs font-semibold text-muted">
            {fromAi ? "✨ Pip 现编的" : "精选金句"}
          </span>
        </div>

        {genState === "error" && (
          <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            生成失败，请确认后端在运行后重试。先看看下面的精选金句吧。
          </p>
        )}

        <ul className="space-y-3.5">
          {lines.map((q, i) => (
            <li key={`${q.text}-${i}`} className="card relative overflow-hidden p-5 md:p-6">
              <span className="absolute -right-3 -top-4 font-display text-6xl font-bold text-coral opacity-10">
                {i + 1}
              </span>
              <p className="font-display text-lg font-semibold leading-snug text-ink md:text-xl">
                {q.text}
              </p>
              <p className="mt-1.5 text-sm font-bold text-coral-deep">— {q.author}</p>
              <p className="mt-0.5 text-sm text-muted">{q.zh}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => speak(q.text)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3.5 py-1.5 text-xs font-bold text-primary-fg shadow-soft transition-transform active:translate-y-0.5"
                >
                  <Volume2 className="h-3.5 w-3.5" /> 朗读
                </button>
                <button
                  type="button"
                  onClick={() => save(q)}
                  disabled={saved.has(q.text)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:text-muted"
                >
                  <Check className="h-3.5 w-3.5" /> {saved.has(q.text) ? "已收藏" : "收藏"}
                </button>
                <PronounceButton text={q.text} />
              </div>
            </li>
          ))}
        </ul>
      </main>

      <BottomNav />
    </div>
  );
}
