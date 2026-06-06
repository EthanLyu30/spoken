import { useState } from "react";
import { Check, Quote as QuoteIcon, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { PronounceButton } from "../components/PronounceButton";
import { fetchTtsUrl, postWord } from "../lib/api";
import { quotes, type Quote } from "../data/quotes";

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

function todayIndex(len: number): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return ((day % len) + len) % len;
}

export default function Daily() {
  const today = quotes[todayIndex(quotes.length)];
  const [saved, setSaved] = useState<Set<string>>(new Set());

  function save(q: Quote) {
    if (saved.has(q.text)) return;
    setSaved((s) => new Set(s).add(q.text));
    postWord({ text: q.text, meaning: `${q.zh} —— ${q.author}` }).catch(() =>
      setSaved((s) => {
        const n = new Set(s);
        n.delete(q.text);
        return n;
      }),
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <div className="mb-6">
          <p className="eyebrow">Daily lines · 每日金句</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">今日金句</h1>
          <p className="mt-1 text-sm text-muted">听一遍、跟读打分、收进生词本 — 每天积累一句。</p>
        </div>

        <section className="card relative overflow-hidden p-6 md:p-8">
          <QuoteIcon
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 text-coral opacity-10"
          />
          <p className="font-display text-2xl font-semibold leading-snug text-ink">{today.text}</p>
          <p className="mt-3 text-sm font-bold text-coral-deep">— {today.author}</p>
          <p className="mt-1 text-sm text-muted">{today.zh}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => speak(today.text)}
              className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5"
            >
              <Volume2 className="h-4 w-4" /> 朗读
            </button>
            <button
              type="button"
              onClick={() => save(today)}
              disabled={saved.has(today.text)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5 disabled:text-muted"
            >
              <Check className="h-4 w-4" /> {saved.has(today.text) ? "已收藏" : "收藏"}
            </button>
          </div>
          <div className="mt-3">
            <PronounceButton text={today.text} />
          </div>
        </section>

        <h2 className="mb-3 mt-8 font-display text-xl font-semibold text-ink">更多金句</h2>
        <ul className="space-y-3">
          {quotes
            .filter((q) => q.text !== today.text)
            .map((q) => (
              <li key={q.text} className="card p-5">
                <p className="font-display text-lg font-semibold leading-snug text-ink">{q.text}</p>
                <p className="mt-1.5 text-xs font-bold text-coral-deep">— {q.author}</p>
                <p className="text-xs text-muted">{q.zh}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => speak(q.text)}
                    className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide text-muted transition-colors hover:text-ink"
                  >
                    <Volume2 className="h-3.5 w-3.5" /> 朗读
                  </button>
                  <button
                    type="button"
                    onClick={() => save(q)}
                    disabled={saved.has(q.text)}
                    className="inline-flex items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide text-coral-deep transition-colors disabled:text-muted"
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
