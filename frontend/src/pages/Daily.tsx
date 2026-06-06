import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, Search, Sparkles, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { PronounceButton } from "../components/PronounceButton";
import { deleteWord, getDailyLines, getWords, postWord, type DailyLine } from "../lib/api";
import { speakText } from "../lib/speech";
import {
  categoryLabels,
  quoteSearchUrl,
  quotes,
  type Quote,
  type QuoteCategory,
} from "../data/quotes";
import { cn } from "../lib/utils";

const SET_SIZE = 5;

type Line = Quote | DailyLine;
const sourceOf = (q: Line): string | undefined => ("source" in q ? q.source : undefined);

/** Categories that actually have entries, in display order. */
const ORDER: QuoteCategory[] = ["movie", "speech", "literature", "people", "proverb"];
const presentCats = ORDER.filter((c) => quotes.some((q) => q.category === c));

/** Day-of-year, so the starting window rotates once per day. */
function dayOfYear(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

/** A wrap-around slice of `n` items starting at `start`. */
function rotateWindow<T>(arr: T[], start: number, n: number): T[] {
  const len = arr.length;
  if (len === 0) return [];
  return Array.from({ length: Math.min(n, len) }, (_, i) => arr[(((start + i) % len) + len) % len]);
}

export default function Daily() {
  // `cat` filters the pool; `page` cycles it; non-null `aiLines` shows AI output.
  const [cat, setCat] = useState<QuoteCategory | "all">("all");
  const [page, setPage] = useState(0);
  const [aiLines, setAiLines] = useState<DailyLine[] | null>(null);
  const [genState, setGenState] = useState<"idle" | "loading" | "error">("idle");
  // text -> word id, so the collect button can toggle (collect / un-collect).
  const [saved, setSaved] = useState<Map<string, number>>(new Map());

  const pool = useMemo(() => (cat === "all" ? quotes : quotes.filter((q) => q.category === cat)), [cat]);
  const base = dayOfYear() * SET_SIZE;
  const curated = useMemo(
    () => rotateWindow(pool, base + page * SET_SIZE, SET_SIZE),
    [pool, base, page],
  );
  const lines: Line[] = aiLines ?? curated;
  const fromAi = aiLines !== null;

  useEffect(() => {
    const ctrl = new AbortController();
    getWords(ctrl.signal)
      .then((ws) => setSaved(new Map(ws.map((w) => [w.text, w.id]))))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  function pickCat(next: QuoteCategory | "all") {
    setCat(next);
    setPage(0);
    setAiLines(null);
  }

  async function toggleSave(q: Line) {
    const existingId = saved.get(q.text);
    if (existingId !== undefined) {
      // Un-collect: remove optimistically, restore on failure.
      setSaved((s) => {
        const n = new Map(s);
        n.delete(q.text);
        return n;
      });
      deleteWord(existingId).catch(() => setSaved((s) => new Map(s).set(q.text, existingId)));
      return;
    }
    const src = sourceOf(q);
    const meaning = `${q.zh} —— ${q.author}${src ? `《${src}》` : ""}`;
    try {
      const w = await postWord({ text: q.text, meaning, kind: "sentence" });
      setSaved((s) => new Map(s).set(q.text, w.id));
    } catch {
      /* ignore */
    }
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
        <div className="mb-4">
          <p className="eyebrow">Daily lines · 每日金句</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">今日五句</h1>
          <p className="mt-1 text-sm text-muted">
            选自电影 / 演讲 / 文学 / 名人，标注出处 · 每天轮换一小组，可点「🔎」去搜原句。
          </p>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", ...presentCats] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pickCat(c)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-bold transition-transform active:translate-y-0.5",
                cat === c
                  ? "bg-coral text-primary-fg shadow-pop"
                  : "border border-border bg-surface text-ink shadow-soft hover:-translate-y-0.5",
              )}
            >
              {c === "all" ? "全部" : categoryLabels[c]}
            </button>
          ))}
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
            {fromAi ? "✨ AI 原创 · 无出处" : "精选 · 标注出处"}
          </span>
        </div>

        {genState === "error" && (
          <p className="mb-4 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            生成失败，请确认后端在运行后重试。先看看下面的精选金句吧。
          </p>
        )}

        <ul data-collect className="space-y-3.5">
          {lines.map((q, i) => {
            const src = sourceOf(q);
            return (
              <li key={`${q.text}-${i}`} className="card relative overflow-hidden p-5 md:p-6">
                <span className="absolute -right-3 -top-4 font-display text-6xl font-bold text-coral opacity-10">
                  {i + 1}
                </span>
                <p className="font-display text-lg font-semibold leading-snug text-ink md:text-xl">
                  {q.text}
                </p>
                <p className="mt-1.5 text-sm font-bold text-coral-deep">— {q.author}</p>
                {src && <p className="mt-0.5 text-xs font-semibold text-muted">出处 · {src}</p>}
                <p className="mt-1 text-sm text-muted">{q.zh}</p>
                {q.usage && (
                  <p className="mt-1.5 rounded-xl bg-surface-2 px-2.5 py-1.5 text-xs font-semibold text-leaf-deep">
                    💬 场景 · {q.usage}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => speakText(q.text)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-coral px-3.5 py-1.5 text-xs font-bold text-primary-fg shadow-soft transition-transform active:translate-y-0.5"
                  >
                    <Volume2 className="h-3.5 w-3.5" /> 朗读
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSave(q)}
                    title={saved.has(q.text) ? "再次点击取消收藏" : "收藏到生词本"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold shadow-soft transition-transform hover:-translate-y-0.5",
                      saved.has(q.text)
                        ? "bg-leaf/15 text-leaf-deep"
                        : "border border-border bg-surface text-ink",
                    )}
                  >
                    <Check className="h-3.5 w-3.5" /> {saved.has(q.text) ? "已收藏" : "收藏"}
                  </button>
                  <PronounceButton text={q.text} />
                  {!fromAi && (
                    <a
                      href={quoteSearchUrl(q)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
                    >
                      <Search className="h-3.5 w-3.5" /> 去搜索
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </main>

      <BottomNav />
    </div>
  );
}
