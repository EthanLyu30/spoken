import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, Plus, Trash2, Volume2 } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { type Word } from "../lib/api";
import { useWords } from "../store/words";
import { speakText } from "../lib/speech";
import { getScenario } from "../data/scenarios";
import { themeFor } from "../lib/theme";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";

/** A word is due for review when it isn't mastered and its due date has passed. */
function isDue(w: Word): boolean {
  if (w.id < 0 || w.mastered) return false;
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
  const [reviewKey, setReviewKey] = useState(0);
  const [deck, setDeck] = useState<Word[]>([]); // snapshot for the review session
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [newWord, setNewWord] = useState("");
  const lastRefreshRef = useRef(Date.now());

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshRef.current < 60_000) return;
      if (useWords.getState().refreshing) return;
      lastRefreshRef.current = Date.now();
      void useWords.getState().refresh();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, []);
  useEffect(() => subscribeAuthGeneration(() => setReview(false)), []);

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
  // Both individual words and short phrases live in the word tab.
  const kindOf = (w: Word) => (w.kind === "sentence" ? "sentence" : "word");
  const wordCount = all.filter((w) => kindOf(w) === "word").length;
  const sentCount = all.filter((w) => kindOf(w) === "sentence").length;
  const active = all.filter((w) => kindOf(w) === tab);
  const dueCount = active.filter(isDue).length;

  function startReview() {
    const dueNow = active.filter(isDue);
    const pool = dueNow.length ? dueNow : active.filter((w) => w.id > 0 && !w.mastered);
    if (!pool.length) return;
    setDeck(pool);
    setReviewKey((key) => key + 1);
    setReview(true);
  }

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />
      <main className="mx-auto wordbag-page">
        <div className="ui-page-head">
          <div>
            <p className="eyebrow">MY WORD BAG</p>
            <h1>把好表达，留给下次用。</h1>
            <p>收藏单词、短语和句子，用间隔复习记得更牢。</p>
          </div>
          <button
            type="button"
            className="ui-button"
            onClick={() => (review ? setReview(false) : startReview())}
            disabled={!active.some((w) => w.id > 0 && !w.mastered)}
          >
            <BookOpen />
            {review ? "列表" : dueCount > 0 ? `复习 ${dueCount}` : "开始复习"}
          </button>
        </div>
        <div className="wordbag-layout">
          <div>
            <div className="wordbag-tabs">
              {(["word", "sentence"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tab === k}
                  onClick={() => {
                    setTab(k);
                    setReview(false);
                  }}
                >
                  {k === "word"
                    ? `单词与短语 ${wordCount}`
                    : `收藏句子 ${sentCount}`}
                </button>
              ))}
            </div>
            {tab === "word" && (
              <div className="wordbag-add">
                <input
                  aria-label="添加单词"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addWord();
                  }}
                  placeholder="添加一个想记的单词…自动补释义和例句"
                />
                <button
                  type="button"
                  className="ui-button"
                  disabled={!newWord.trim()}
                  onClick={addWord}
                >
                  <Plus />
                  添加
                </button>
              </div>
            )}
            {showLoading && (
              <p role="status" className="wordbag-state">
                正在加载你的收藏…
              </p>
            )}
            {showError && (
              <section className="wordbag-state">
                <p role="alert">暂时无法读取收藏，请稍后重试。</p>
                <button
                  type="button"
                  className="ui-secondary"
                  onClick={() => void useWords.getState().refresh()}
                >
                  重试读取
                </button>
              </section>
            )}
            {showEmpty && (
              <section className="wordbag-state">
                <Buddy mood="happy" size={90} />
                <h2>还没有收藏</h2>
                <p>添加第一个单词，或去每日金句收藏喜欢的表达。</p>
                <Link to="/daily" className="ui-link">
                  去看看金句
                </Link>
              </section>
            )}
            {hasCache &&
              (review ? (
                <ReviewDeck
                  key={reviewKey}
                  deck={deck}
                  review={reviewWordId}
                  onDone={() => setReview(false)}
                />
              ) : active.length === 0 ? (
                <p className="wordbag-state">
                  {tab === "word"
                    ? "还没有单词，试着加一个吧。"
                    : "还没有收藏句子，去每日金句找找灵感。"}
                </p>
              ) : (
                <ul className="space-y-3">
                  {active.map((w) => {
                    const sc = w.scenario_id
                      ? getScenario(w.scenario_id)
                      : undefined;
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
                            style={
                              w.mastered
                                ? {
                                    textDecoration: "line-through",
                                    opacity: 0.55,
                                  }
                                : undefined
                            }
                          >
                            {w.text}
                          </span>
                          <span className="flex items-center gap-2">
                            {w.mastered && (
                              <Check className="h-4 w-4 text-leaf" />
                            )}
                            <span className="max-w-[9rem] truncate text-sm text-muted">
                              {w.meaning}
                            </span>
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
                                <Check className="h-3.5 w-3.5" />{" "}
                                {w.mastered ? "取消掌握" : "标记掌握"}
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
              ))}
          </div>
          <aside className="wordbag-aside">
            <h2>今天，复习这一小组。</h2>
            <p>
              当前分组有 <strong>{dueCount}</strong>{" "}
              条到期表达。记得的稍后再见，忘记的很快再练。
            </p>
            <button
              type="button"
              className="ui-button"
              disabled={!active.some((w) => w.id > 0 && !w.mastered)}
              onClick={startReview}
            >
              开始复习
            </button>
            <section>
              <h3>把表达真正用起来</h3>
              <p>先想意思，再翻面看答案。下次对话时，试着用上一句。</p>
              <Link to="/scenes" className="ui-link">
                去场景里试试
              </Link>
            </section>
          </aside>
        </div>
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
  review: (id: number, remembered: boolean) => Promise<void>;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [stats, setStats] = useState({ know: 0, again: 0 });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [failed, setFailed] = useState<{ id: number; remembered: boolean } | null>(null);
  const choice = useRef<boolean | null>(null);
  const locked = useRef(false);
  const pending = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // A new card re-opens the click guard; the previous save keeps running in
  // the background and never blocks this card.
  useEffect(() => { locked.current = false; }, [i]);
  const w = deck[i];

  if (!w) {
    return (
      <section className="card grid place-items-center gap-3 p-8 text-center">
        <Buddy mood="cheer" size={120} />
        <h3 className="font-display text-xl font-semibold text-ink">
          复习完成！
        </h3>
        <p className="text-sm text-muted">
          记得 {stats.know} · 待加强 {stats.again}
        </p>
        <p className="text-xs text-muted">
          记得的词会过段时间再出现，忘了的很快会再考你。
        </p>
        {saveError && failed && (
          <div role="alert" className="wordbag-save-error">
            <span>有一条复习尚未确认保存。</span>
            <Button onClick={() => void retryFailed()}>重试保存</Button>
          </div>
        )}
        <Button onClick={onDone}>回到列表</Button>
      </section>
    );
  }

  function answer(remembered: boolean) {
    if (locked.current || !w) return;
    locked.current = true;
    const generation = getAuthGeneration();
    const target = w;
    const selected = choice.current ?? remembered;
    choice.current = selected;
    // Advance immediately. The idempotent, owner-scoped review write continues
    // in the background; a failure is surfaced with a retry that reuses the
    // same receipt instead of trapping the learner on this card.
    setStats((s) => (selected ? { ...s, know: s.know + 1 } : { ...s, again: s.again + 1 }));
    setFlipped(false);
    setI((x) => x + 1);
    choice.current = null;
    pending.current++;
    setSaving(true);
    const current = () => mounted.current && generation === getAuthGeneration();
    void Promise.resolve(review(target.id, selected)).catch((error: unknown) => {
      if (!current()) return;
      // A previous deck may have left an ambiguous save. Recover its original
      // choice before retrying the same receipt, rather than trapping retries.
      const retryChoice = error && typeof error === "object" && "remembered" in error && typeof (error as { remembered?: unknown }).remembered === "boolean"
        ? (error as { remembered: boolean }).remembered
        : selected;
      setFailed({ id: target.id, remembered: retryChoice });
      setSaveError(true);
    }).finally(() => {
      if (!current()) return;
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current === 0) setSaving(false);
    });
  }

  async function retryFailed() {
    if (!failed) return;
    const target = failed;
    setSaveError(false);
    try {
      await review(target.id, target.remembered);
      if (mounted.current) setFailed(null);
    } catch {
      if (mounted.current) setSaveError(true);
    }
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
          <span className="font-display text-2xl font-bold text-ink">
            {w.text}
          </span>
        ) : (
          <div>
            <p className="text-lg text-ink">{w.meaning || "（暂无释义）"}</p>
            {w.example && (
              <p className="mt-2 text-sm text-muted">{w.example}</p>
            )}
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
      {saving && <p role="status">正在后台保存复习…</p>}
      {saveError && failed && (
        <div role="alert" className="wordbag-save-error">
          <span>上次选择“{failed.remembered ? "记得" : "忘了"}”尚未确认保存。</span>
          <Button onClick={() => void retryFailed()}>重试保存</Button>
        </div>
      )}
    </section>
  );
}
