import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Check, Plus, Trash2, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { type Word } from "../lib/api";
import { useWords } from "../store/words";
import { speakText } from "../lib/speech";
import { getScenario } from "../data/scenarios";
import { themeFor } from "../lib/theme";
import { cn } from "../lib/utils";

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

/** A word is due for review when it isn't mastered and its due date has passed. */
function isDue(w: Word): boolean {
  if (w.mastered) return false;
  if (!w.due_at) return true;
  const due = new Date(w.due_at.endsWith("Z") ? w.due_at : `${w.due_at}Z`);
  return Number.isNaN(due.getTime()) || due.getTime() <= Date.now();
}

export default function WordBag() {
  const words = useWords((s) => s.words);
  const fetchedOnce = useWords((s) => s.fetchedOnce);
  const error = useWords((s) => s.error);
  const ensureLoaded = useWords((s) => s.ensureLoaded);
  const collect = useWords((s) => s.collect);
  const removeWord = useWords((s) => s.remove);
  const toggleMaster = useWords((s) => s.toggleMaster);
  const reviewWordId = useWords((s) => s.review);

  const [open, setOpen] = useState<number | null>(null);
  const [review, setReview] = useState(false);
  const [deck, setDeck] = useState<Word[]>([]); // snapshot for the review session
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [newWord, setNewWord] = useState("");

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  function addWord() {
    const text = newWord.trim();
    if (!text) return;
    collect({ text, kind: "word" }); // optimistic —释义/例句 fill in shortly
    setNewWord("");
    setTab("word");
  }

  const all = words;
  const hasCache = all.length > 0;
  const showLoading = !hasCache && !fetchedOnce && !error;
  const showError = !hasCache && error;
  const showEmpty = !hasCache && fetchedOnce && !error;
  const kindOf = (w: Word) => (w.kind === "sentence" ? "sentence" : "word");
  const wordCount = all.filter((w) => kindOf(w) === "word").length;
  const sentCount = all.filter((w) => kindOf(w) === "sentence").length;
  const active = all.filter((w) => kindOf(w) === tab);
  const dueCount = active.filter(isDue).length;

  function startReview() {
    const dueNow = active.filter(isDue);
    const pool = dueNow.length ? dueNow : active.filter((w) => !w.mastered);
    if (!pool.length) return;
    setDeck(pool);
    setReview(true);
  }

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
            onClick={() => (review ? setReview(false) : startReview())}
            className="inline-flex items-center gap-1.5 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5"
          >
            <BookOpen className="h-4 w-4" />
            {review ? "列表" : dueCount > 0 ? `复习 ${dueCount}` : "复习"}
          </button>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        <div className="mb-5">
          <p className="eyebrow">Word bag · 生词本</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">我的生词本</h1>
        </div>

        {showLoading && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="mt-3 text-muted">正在加载…</p>
          </section>
        )}

        {showError && (
          <section className="card grid place-items-center gap-3 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="font-semibold text-ink">读取失败，请确认后端在运行。</p>
            <Link to="/">
              <Button variant="soft">回首页</Button>
            </Link>
          </section>
        )}

        {showEmpty && (
          <section className="card grid place-items-center gap-2 p-10 text-center">
            <Buddy mood="happy" size={140} />
            <h2 className="mt-2 font-display text-xl font-semibold text-ink">还没有收藏</h2>
            <p className="text-muted">在课后小结点「收藏」存表达，在「金句」收藏句子，或在下面直接加单词。</p>
          </section>
        )}

        {hasCache && (
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
                  disabled={!newWord.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral px-4 py-2 text-sm font-bold text-primary-fg shadow-soft transition-transform active:translate-y-0.5 disabled:opacity-40"
                >
                  <Plus className="h-4 w-4" /> 添加
                </button>
              </div>
            )}

            {active.length === 0 ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-sm text-muted">
                {tab === "word" ? "还没有收藏单词，上面加一个吧。" : "还没有收藏句子，去「金句」收藏几句。"}
              </p>
            ) : review ? (
              <ReviewDeck deck={deck} review={reviewWordId} onDone={() => setReview(false)} />
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
                              onClick={() => toggleMaster(w.id)}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
                            >
                              <Check className="h-3.5 w-3.5" /> {w.mastered ? "取消掌握" : "标记掌握"}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeWord(w.id)}
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

/** Spaced-repetition review: flip the card, then grade 记得 / 忘了. */
function ReviewDeck({
  deck,
  review,
  onDone,
}: {
  deck: Word[];
  review: (id: number, remembered: boolean) => void;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ know: 0, again: 0 });
  const w = deck[i];

  if (!w) {
    return (
      <section className="card grid place-items-center gap-3 p-8 text-center">
        <Buddy mood="cheer" size={120} />
        <h3 className="font-display text-xl font-semibold text-ink">复习完成！</h3>
        <p className="text-sm text-muted">
          记得 {stats.know} · 待加强 {stats.again}
        </p>
        <p className="text-xs text-muted">记得的词会过段时间再出现，忘了的很快会再考你。</p>
        <Button onClick={onDone}>回到列表</Button>
      </section>
    );
  }

  function answer(remembered: boolean) {
    review(w.id, remembered); // optimistic — the store syncs the SRS schedule in the background
    setStats((s) => (remembered ? { ...s, know: s.know + 1 } : { ...s, again: s.again + 1 }));
    setFlipped(false);
    setI((x) => x + 1);
  }

  return (
    <section className="card grid place-items-center gap-4 p-8 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">
        {i + 1} / {deck.length}
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => speakText(w.text)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink"
        >
          <Volume2 className="h-3.5 w-3.5" /> 朗读
        </button>
        <span className="text-xs text-muted">点卡片翻面看释义</span>
      </div>
      <div className="flex gap-3">
        <Button variant="soft" onClick={() => answer(false)}>
          忘了
        </Button>
        <Button onClick={() => answer(true)}>记得 ✓</Button>
      </div>
    </section>
  );
}
