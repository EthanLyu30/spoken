import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, Plus, Trash2, Volume2 } from "lucide-react";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import type { Word } from "../lib/api";
import { useWords } from "../store/words";
import { speakText } from "../lib/speech";
import { getScenario } from "../data/scenarios";
import { themeFor } from "../lib/theme";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { familiarityOf, reviewDueAt, reviewPrompt, type ReviewMode } from "../lib/wordReview";
import { SceneBookmarks } from "../components/SceneBookmarks";
import { WordReviewDeck, ReviewDue } from "../components/WordReviewDeck";
import "./WordBagStudy.css";

const familiarityLabels = { new: "未复习", familiar: "熟悉", uncertain: "模糊", forgot: "遗忘" };
const topicOf = (word: Word) => word.topic || getScenario(word.scenario_id)?.titleZh || (word.scenario_id === "custom" ? "自定义场景" : "未分类");

/** A word is due for review when it isn't mastered and its due date has passed. */
function isDue(w: Word): boolean {
  if (w.id < 0 || w.mastered) return false;
  const due = reviewDueAt(w.due_at);
  return !due || due.getTime() <= Date.now();
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
  const [deck, setDeck] = useState<{ words: Word[]; mode: ReviewMode }>({ words: [], mode: "flip" });
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [newWord, setNewWord] = useState("");
  const [topic, setTopic] = useState("");
  const [familiarity, setFamiliarity] = useState("");
  const [preferredMode, setPreferredMode] = useState<ReviewMode | null>(null);
  const [topicNotice, setTopicNotice] = useState("");
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
  useEffect(() => subscribeAuthGeneration(() => {
    setReview(false); setOpen(null); setTopic(""); setFamiliarity(""); setTopicNotice(""); setPreferredMode(null);
  }), []);

  function addWord() {
    const text = newWord.trim();
    if (!text) return;
    collect({ text, kind: "word", ...(topic && topic !== "未分类" ? { topic } : {}) });
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
  const topics = [...new Set(all.map(topicOf))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const active = all.filter(w => kindOf(w) === tab && (!topic || topicOf(w) === topic)
    && (!familiarity || familiarityOf(w) === familiarity));
  const eligible = active.filter(w => w.id > 0 && (!w.mastered || familiarity === "familiar"));
  const dueEligible = eligible.filter(isDue);
  const modeCandidates = dueEligible.length ? dueEligible : eligible;
  const mode = preferredMode ?? (["translate", "cloze"] as const).find(option =>
    modeCandidates.some(word => reviewPrompt(word, option))) ?? "flip";
  const reviewable = eligible.filter(w => mode === "flip" || reviewPrompt(w, mode));
  const dueCount = reviewable.filter(isDue).length;

  function startReview() {
    const dueNow = reviewable.filter(isDue);
    const pool = dueNow.length ? dueNow : reviewable;
    if (!pool.length) return;
    setDeck({ words: pool, mode });
    setReviewKey((key) => key + 1);
    setReview(true);
  }

  return (
    <div className="min-h-screen pb-24">
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
            disabled={!review && !reviewable.length}
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
            <div className="wordbag-study-filters">
              <label>话题<select value={topic} onChange={event => { setTopic(event.target.value); setReview(false); setOpen(null); setTopicNotice(""); }}>
                <option value="">全部话题</option>
                {topic && !topics.includes(topic) && <option value={topic}>{topic}</option>}
                {topics.map(name => <option key={name} value={name}>{name}</option>)}
              </select></label>
              <label>熟悉度<select value={familiarity} onChange={event => { setFamiliarity(event.target.value); setReview(false); }}>
                <option value="">全部熟悉度</option>
                {Object.entries(familiarityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>复习方式<select value={mode} onChange={event => {
                setPreferredMode(event.target.value as ReviewMode); setReview(false);
              }}>
                <option value="flip">翻卡回忆</option>
                <option value="translate">看中文写英文</option>
                <option value="cloze">关键词填空</option>
              </select></label>
              {mode !== "flip" && eligible.length > reviewable.length && <p>本组有 {eligible.length - reviewable.length} 条缺少可用题面，可用翻卡复习。</p>}
            </div>
            {!review && topic && topics.includes(topic) && <TopicGroupEditor key={topic} source={topic} topics={topics}
              count={all.filter(word => word.id > 0 && topicOf(word) === topic).length} onSaved={(target, count) => {
                setTopic(current => current === topic ? target ?? "" : current);
                setTopicNotice(count ? `已更新 ${count} 条表达的话题。` : "已同步当前话题。");
              }} />}
            {topicNotice && <p className="wordbag-topic-notice" role="status">{topicNotice}</p>}
            {!review && <SceneBookmarks />}
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
                <WordReviewDeck
                  key={reviewKey}
                  deck={deck.words}
                  mode={deck.mode}
                  review={reviewWordId}
                  onDone={() => setReview(false)}
                />
              ) : active.length === 0 ? (
                <p className="wordbag-state">
                  {topic || familiarity ? "这个筛选下还没有收藏。" : tab === "word"
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
                            <ReviewDue word={w} />
                            <WordTopicEditor key={w.id} word={w} topics={topics} onChange={(next) => {
                              if (topic && next !== topic) setTopic(next);
                            }} />
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
              当前方式有 <strong>{dueCount}</strong>{" "}
              条到期表达。熟悉的隔久一点，模糊或遗忘的早点再练。
            </p>
            <button
              type="button"
              className="ui-button"
              disabled={!reviewable.length}
              onClick={startReview}
            >
              开始复习
            </button>
            <section>
              <h3>把表达真正用起来</h3>
              <p>先自己想或写出答案，再对照参考标记熟悉度。下次对话时，试着用上一句。</p>
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

function WordTopicEditor({ word, topics, onChange }: { word: Word; topics: string[]; onChange: (topic: string) => void }) {
  const save = useWords(s => s.setTopic);
  const [value, setValue] = useState<string>();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return <form className="wordbag-topic-editor" onSubmit={async event => {
    event.preventDefault();
    if (pending || value === undefined) return;
    setPending(true); setFailed(false);
    const generation = getAuthGeneration();
    try {
      await save(word.id, value.trim() || null);
      if (generation === getAuthGeneration()) { setValue(undefined); onChange(topicOf({ ...word, topic: value.trim() })); }
    } catch { if (generation === getAuthGeneration()) setFailed(true); }
    finally { if (generation === getAuthGeneration()) setPending(false); }
  }}>
    <label>话题名称<input list={`word-topics-${word.id}`} maxLength={48} value={value ?? word.topic ?? ""}
      placeholder={topicOf({ ...word, topic: null })} onChange={e => setValue(e.target.value)} disabled={word.id < 1 || pending} /></label>
    <datalist id={`word-topics-${word.id}`}>{topics.map(name => <option key={name} value={name} />)}</datalist>
    <button type="submit" className="ui-secondary" disabled={word.id < 1 || pending || value === undefined}>保存话题</button>
    <small>留空使用原场景分组</small>
    {failed && <p role="alert">话题未保存，请重试。</p>}
  </form>;
}

function TopicGroupEditor({ source, topics, count, onSaved }: {
  source: string; topics: string[]; count: number; onSaved: (target: string | null, changed: number) => void;
}) {
  const edit = useWords(s => s.editTopic);
  const [name, setName] = useState(source);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const target = name.trim();
  const merges = target !== source && topics.includes(target);

  async function save(value: string | null) {
    if (pending) return;
    const generation = getAuthGeneration();
    setPending(true);
    setError(false);
    try {
      const changed = await edit(source, value);
      if (generation === getAuthGeneration()) onSaved(value, changed);
    } catch {
      if (generation === getAuthGeneration()) setError(true);
    } finally {
      if (generation === getAuthGeneration()) setPending(false);
    }
  }

  return <details className="wordbag-group-editor">
    <summary>编辑整组话题 · {count} 条表达</summary>
    <form className="wordbag-topic-editor" onSubmit={event => {
      event.preventDefault();
      if (target && target !== source) void save(target);
    }}>
      <label>整组话题名称<input value={name} list="wordbag-group-targets" maxLength={48} disabled={pending}
        onChange={event => setName(event.target.value)} /></label>
      <datalist id="wordbag-group-targets">{topics.filter(topic => topic !== source).map(topic => <option key={topic} value={topic} />)}</datalist>
      <button type="submit" className="ui-secondary" disabled={pending || !target || target === source}>{merges ? "合并到已有话题" : "重命名整组"}</button>
      <button type="button" className="ui-link" disabled={pending} onClick={() => void save(null)}>恢复按原场景归组</button>
      <small>整组操作包含单词、短语和句子。</small>
      {error && <p role="alert">话题更新失败，请重试。</p>}
    </form>
  </details>;
}
