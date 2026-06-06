import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Check, Trash2, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { deleteWord, fetchTtsUrl, getWords, patchWord, type Word } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { themeFor } from "../lib/theme";

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

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

export default function WordBag() {
  const [words, setWords] = useState<Word[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getWords(ctrl.signal)
      .then(setWords)
      .catch(() => {
        if (!ctrl.signal.aborted) setError(true);
      });
    return () => ctrl.abort();
  }, []);

  async function toggleMaster(w: Word) {
    const u = await patchWord(w.id, !w.mastered).catch(() => null);
    if (u) setWords((ws) => (ws ? ws.map((x) => (x.id === w.id ? u : x)) : ws));
  }
  async function remove(w: Word) {
    await deleteWord(w.id).catch(() => undefined);
    setWords((ws) => (ws ? ws.filter((x) => x.id !== w.id) : ws));
  }

  const total = words?.length ?? 0;
  const mastered = words?.filter((w) => w.mastered).length ?? 0;

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 pt-6">
        <Link to="/" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
        {total > 0 && (
          <button
            type="button"
            onClick={() => setReview((r) => !r)}
            className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5"
          >
            <BookOpen className="h-4 w-4" /> {review ? "列表" : "复习"}
          </button>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        <div className="mb-6">
          <p className="eyebrow">Word bag · 生词本</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">我的生词本</h1>
          {total > 0 && (
            <p className="mt-1 text-sm text-muted">
              共 {total} 个 · 已掌握 {mastered}
            </p>
          )}
        </div>

        {words === null && !error && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="mt-3 text-muted">正在加载…</p>
          </section>
        )}

        {error && (
          <section className="card grid place-items-center gap-3 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="font-semibold text-ink">读取失败，请确认后端在运行。</p>
            <Link to="/">
              <Button variant="soft">回首页</Button>
            </Link>
          </section>
        )}

        {words && total === 0 && (
          <section className="card grid place-items-center gap-2 p-10 text-center">
            <Buddy mood="happy" size={140} />
            <h2 className="mt-2 font-display text-xl font-semibold text-ink">还没有收藏的词</h2>
            <p className="text-muted">在课后小结里点「收藏」，把好用表达存进来。</p>
            <Link to="/" className="mt-3">
              <Button size="lg">去练一段</Button>
            </Link>
          </section>
        )}

        {words && total > 0 && review && <Flashcards words={words} onMaster={toggleMaster} />}

        {words && total > 0 && !review && (
          <ul className="space-y-3">
            {words.map((w) => {
              const sc = w.scenario_id ? getScenario(w.scenario_id) : undefined;
              const t = themeFor(w.scenario_id);
              const isOpen = open === w.id;
              return (
                <li key={w.id} className="card overflow-hidden p-0">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : w.id)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="font-display text-lg font-semibold text-ink"
                        style={w.mastered ? { textDecoration: "line-through", opacity: 0.55 } : undefined}
                      >
                        {w.text}
                      </span>
                      {w.mastered && <Check className="h-4 w-4 text-leaf" />}
                    </span>
                    <span className="truncate text-sm text-muted">{w.meaning}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border bg-surface-2 px-5 py-4">
                      {w.meaning && (
                        <p className="text-sm text-ink">
                          <span className="font-bold">释义：</span>
                          {w.meaning}
                        </p>
                      )}
                      {w.example && (
                        <p className="mt-1 text-sm text-ink">
                          <span className="font-bold">例句：</span>
                          {w.example}
                        </p>
                      )}
                      {sc && (
                        <span
                          className="mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{ background: t.soft, color: t.deep }}
                        >
                          {sc.titleZh}
                        </span>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => speak(w.text)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          <Volume2 className="h-3.5 w-3.5" /> 朗读
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMaster(w)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                        >
                          <Check className="h-3.5 w-3.5" /> {w.mastered ? "取消掌握" : "标记掌握"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(w)}
                          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-[#e6503d]"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 删除
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function Flashcards({ words, onMaster }: { words: Word[]; onMaster: (w: Word) => void }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const w = words[i % words.length];
  function next() {
    setFlipped(false);
    setI((x) => (x + 1) % words.length);
  }
  return (
    <section className="card grid place-items-center gap-4 p-8 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">
        {(i % words.length) + 1} / {words.length}
      </p>
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="grid min-h-[9rem] w-full place-items-center rounded-3xl bg-surface-2 px-6 py-8"
      >
        {!flipped ? (
          <span className="font-display text-3xl font-bold text-ink">{w.text}</span>
        ) : (
          <div>
            <p className="text-lg text-ink">{w.meaning || "（暂无释义）"}</p>
            {w.example && <p className="mt-2 text-sm text-muted">{w.example}</p>}
          </div>
        )}
      </button>
      <p className="text-xs text-muted">点卡片翻面看释义</p>
      <div className="flex gap-3">
        <Button variant="soft" onClick={next}>
          下一个
        </Button>
        <Button
          onClick={() => {
            if (!w.mastered) onMaster(w);
            next();
          }}
        >
          认识 ✓
        </Button>
      </div>
    </section>
  );
}
