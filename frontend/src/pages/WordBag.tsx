import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Check, Plus, Trash2, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { deleteWord, getWords, patchWord, postWord, type Word } from "../lib/api";
import { speakText } from "../lib/speech";
import { getScenario } from "../data/scenarios";
import { themeFor } from "../lib/theme";
import { cn } from "../lib/utils";

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

export default function WordBag() {
  const [words, setWords] = useState<Word[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [newWord, setNewWord] = useState("");
  const [adding, setAdding] = useState(false);

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
  async function addWord() {
    const text = newWord.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const w = await postWord({ text, kind: "word" });
      setWords((ws) => (ws && !ws.some((x) => x.id === w.id) ? [w, ...ws] : ws));
      setNewWord("");
      setTab("word");
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  }

  const all = words ?? [];
  const kindOf = (w: Word) => (w.kind === "sentence" ? "sentence" : "word");
  const wordCount = all.filter((w) => kindOf(w) === "word").length;
  const sentCount = all.filter((w) => kindOf(w) === "sentence").length;
  const active = all.filter((w) => kindOf(w) === tab);

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-5 pt-6">
        <Link to="/" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
        {active.length > 0 && (
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
        <div className="mb-5">
          <p className="eyebrow">Word bag · 生词本</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">我的生词本</h1>
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

        {words && all.length === 0 && (
          <section className="card grid place-items-center gap-2 p-10 text-center">
            <Buddy mood="happy" size={140} />
            <h2 className="mt-2 font-display text-xl font-semibold text-ink">还没有收藏</h2>
            <p className="text-muted">在课后小结点「收藏」存表达，在「金句」收藏句子，或在下面直接加单词。</p>
          </section>
        )}

        {words && all.length > 0 && (
          <>
            <div className="mb-4 flex gap-2">
              {(["word", "sentence"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setTab(k);
                    setReview(false);
                  }}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-bold transition-transform active:translate-y-0.5",
                    tab === k
                      ? "bg-coral text-primary-fg shadow-pop"
                      : "border border-border bg-surface text-ink shadow-soft hover:-translate-y-0.5",
                  )}
                >
                  {k === "word" ? `单词 ${wordCount}` : `句子 ${sentCount}`}
                </button>
              ))}
            </div>

            {tab === "word" && (
              <div className="mb-4 flex items-center gap-2 rounded-full border border-border bg-surface p-2 shadow-soft">
                <input
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addWord();
                  }}
                  placeholder="添加一个想记的单词…（自动补释义和例句）"
                  className="min-w-0 flex-1 bg-transparent px-3 text-ink outline-none placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={addWord}
                  disabled={adding || !newWord.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-soft transition-transform active:translate-y-0.5 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> {adding ? "添加中…" : "添加"}
                </button>
              </div>
            )}

            {active.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">
                {tab === "word" ? "还没有收藏单词，上面加一个吧。" : "还没有收藏句子，去「金句」收藏几句。"}
              </p>
            ) : review ? (
              <Flashcards words={active} onMaster={toggleMaster} />
            ) : (
              <ul className="space-y-3">
                {active.map((w) => {
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
                        <span
                          className="font-display font-semibold text-ink"
                          style={w.mastered ? { textDecoration: "line-through", opacity: 0.55 } : undefined}
                        >
                          {w.text}
                        </span>
                        <span className="flex items-center gap-2">
                          {w.mastered && <Check className="h-4 w-4 text-leaf" />}
                          <span className="max-w-[9rem] truncate text-sm text-muted">{w.meaning}</span>
                        </span>
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
                              onClick={() => speakText(w.text)}
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
          </>
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
          <span className="font-display text-2xl font-bold text-ink">{w.text}</span>
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
