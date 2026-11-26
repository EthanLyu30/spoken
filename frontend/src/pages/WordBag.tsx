import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Clock, Plus, RotateCcw, Trash2, Volume2 } from "lucide-react";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import type { Word } from "../lib/api";
import { useWords } from "../store/words";
import { speakText } from "../lib/speech";
import { getScenario } from "../data/scenarios";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { familiarityOf, reviewDueAt, reviewModeForWord, type ReviewMode } from "../lib/wordReview";
import { SceneBookmarks } from "../components/SceneBookmarks";
import { WordReviewDeck, ReviewDue } from "../components/WordReviewDeck";
import { WordReviewContext } from "../components/WordReviewContext";
import { WordRetest } from "../components/WordRetest";
import { WordBagArtwork, WordBagMotionProvider } from "../components/WordBagArtwork";
import { WordBagFilters } from "../components/WordBagFilters";
import "./WordBagStudy.css";

const familiarityLabels = { new: "待学习", familiar: "熟悉", uncertain: "模糊", forgot: "遗忘" };
const topicOf = (word: Word) => word.topic || getScenario(word.scenario_id)?.titleZh || (word.scenario_id === "custom" ? "自定义场景" : "未分类");
const dueTime = (word: Word) => reviewDueAt(word.due_at)?.getTime() ?? 0;

export default function WordBag() {
  return <WordBagMotionProvider><WordBagContent /></WordBagMotionProvider>;
}

function WordBagContent() {
  const words = useWords((s) => s.words);
  const fetchedOnce = useWords((s) => s.fetchedOnce);
  const error = useWords((s) => s.error);
  const ensureLoaded = useWords((s) => s.ensureLoaded);
  const collect = useWords((s) => s.collect);
  const removeWord = useWords((s) => s.remove);
  const toggleMaster = useWords((s) => s.toggleMaster);
  const reviewWordId = useWords((s) => s.review);

  const [open, setOpen] = useState<number | null>(null);
  const [deck, setDeck] = useState<{ words: Word[]; mode: ReviewMode; kind: "learn" | "due" | "early" } | null>(null);
  const [retesting, setRetesting] = useState(false);
  const [tab, setTab] = useState<"word" | "sentence">("word");
  const [newWord, setNewWord] = useState("");
  const [topic, setTopic] = useState("");
  const [familiarity, setFamiliarity] = useState("");
  const [preferredMode, setPreferredMode] = useState<ReviewMode | null>(null);
  const [topicNotice, setTopicNotice] = useState("");
  const [, updateClock] = useState(Date.now);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(false);
  const lastRefreshRef = useRef(Date.now());
  const viewingList = !deck && !retesting;

  useEffect(() => {
    if (!viewingList || !returnFocus.current) return;
    returnFocus.current = false;
    listHeading.current?.focus();
  }, [viewingList]);

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState !== "visible") return;
      updateClock(Date.now());
      if (Date.now() - lastRefreshRef.current < 60_000) return;
      if (useWords.getState().refreshing) return;
      lastRefreshRef.current = Date.now();
      void useWords.getState().refresh();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    const timer = window.setInterval(() => updateClock(Date.now()), 60_000);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => subscribeAuthGeneration(() => {
    setDeck(null); setRetesting(false); setOpen(null); setTopic(""); setFamiliarity(""); setTopicNotice(""); setPreferredMode(null);
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
  const newWords = eligible.filter(word => familiarityOf(word) === "new");
  const learned = eligible.filter(word => familiarityOf(word) !== "new").sort((a, b) => dueTime(a) - dueTime(b) || a.id - b.id);
  const now = Date.now();
  const due = learned.filter(word => !word.mastered && dueTime(word) <= now);
  const nextDue = learned.find(word => !word.mastered && dueTime(word) > now);
  const modeCandidates = newWords.length ? newWords : due.length ? due : learned;
  const mode = preferredMode ?? (["translate", "cloze"] as const).find(option =>
    modeCandidates.some(word => reviewModeForWord(word, option) === option)) ?? "flip";
  const recallCount = mode === "flip" ? 0 : eligible.filter(word => reviewModeForWord(word, mode) === "flip").length;
  const chooseEarly = due.length === 0 && learned.length > 0;

  function startRound(pool: Word[], kind: "learn" | "due" | "early") {
    if (!pool.length) return;
    setDeck({ words: pool, mode, kind });
    setOpen(null);
  }

  function closeRetest(focus?: "forgot" | "uncertain") {
    const generation = getAuthGeneration();
    returnFocus.current = true;
    setRetesting(false);
    if (focus) { setFamiliarity(focus); setTopic(""); setOpen(null); }
    void useWords.getState().refresh().then(() => {
      if (!focus || generation !== getAuthGeneration()) return;
      const matching = useWords.getState().words.filter(word => familiarityOf(word) === focus);
      setTab(current => !matching.length || matching.some(word => kindOf(word) === current) ? current : kindOf(matching[0]));
    });
  }

  function closeDeck() {
    returnFocus.current = true;
    setDeck(null);
  }

  if (deck || retesting) {
    const title = retesting ? "重测已有收藏" : deck?.kind === "learn" ? "学习新收藏" : deck?.kind === "early" ? "提前复习" : "到期复习";
    return <div className="min-h-screen pb-24">
      <main className="mx-auto wordbag-focus">
        <header className="wordbag-focus-header">
          <button type="button" className="ui-secondary" onClick={() => retesting ? closeRetest() : closeDeck()}>
            <ArrowLeft aria-hidden="true" /> 返回列表
          </button>
          {!retesting && <h1>{title}</h1>}
        </header>
        {retesting ? <WordRetest onClose={closeRetest} onFocus={closeRetest} /> : deck && <WordReviewDeck
          deck={deck.words} mode={deck.mode} activity={deck.kind === "learn" ? "learn" : "review"}
          review={reviewWordId} onDone={closeDeck} />}
      </main>
      <BottomNav />
    </div>;
  }

  const artworkScene = topic ? active.find(word => getScenario(word.scenario_id))?.scenario_id : undefined;
  const scope = [tab === "word" ? "单词与短语" : "收藏句子", topic, familiarityLabels[familiarity as keyof typeof familiarityLabels]].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen pb-24">
      <main className="mx-auto wordbag-page">
        <section className="wordbag-hero" aria-labelledby="wordbag-title">
          <div className="wordbag-hero-copy">
            <p className="wordbag-hero-kicker">生词本 <span aria-hidden="true">/</span> 今日安排</p>
            <h1 id="wordbag-title" ref={listHeading} tabIndex={-1}><span>把好表达，</span><span>留给下次用。</span></h1>
            <div className="wordbag-plan" aria-label="学习与复习">
              <p className="wordbag-scope">当前范围 · {scope}</p>
              {(fetchedOnce || hasCache) && <div className="wordbag-queue-actions">
                <button type="button" className={newWords.length ? "ui-button" : "ui-secondary"}
                  onClick={() => startRound(newWords, "learn")} disabled={!newWords.length}>
                  <BookOpen aria-hidden="true" /> 学习新收藏 <span>{newWords.length}</span>
                </button>
                <button type="button" className={!newWords.length && due.length ? "ui-button" : "ui-secondary"}
                  onClick={() => startRound(due, "due")} disabled={!due.length}>
                  <Clock aria-hidden="true" /> 复习到期表达 <span>{due.length}</span>
                </button>
              </div>}
              {!due.length && nextDue && <ReviewDue word={nextDue} />}
              {(fetchedOnce || hasCache) && <div className="wordbag-plan-links">
                {chooseEarly && <button type="button" className="ui-link" onClick={() => startRound(learned, "early")}>提前复习 {learned.length}</button>}
                <button type="button" className="ui-link" onClick={() => setRetesting(true)}><RotateCcw size={15} aria-hidden="true" /> 重测已有收藏</button>
              </div>}
            </div>
          </div>
          <WordBagArtwork scenarioId={artworkScene} />
        </section>
        <div className="wordbag-library">
          <div className="wordbag-library-tools">
            <div className="wordbag-tabs">
              {(["word", "sentence"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={tab === k}
                  onClick={() => {
                    setTab(k);
                    setOpen(null);
                  }}
                >
                  {k === "word"
                    ? `单词与短语 ${wordCount}`
                    : `收藏句子 ${sentCount}`}
                </button>
              ))}
            </div>
            <WordBagFilters topics={topics} topic={topic} familiarity={familiarity} mode={mode}
              onTopic={next => { setTopic(next); setOpen(null); setTopicNotice(""); }}
              onFamiliarity={setFamiliarity} onMode={setPreferredMode} />
          </div>
            {recallCount > 0 && <p className="wordbag-mode-note">本组有 {recallCount} 条会用翻卡回忆。</p>}
            {topic && topics.includes(topic) && <TopicGroupEditor key={topic} source={topic} topics={topics}
              count={all.filter(word => word.id > 0 && topicOf(word) === topic).length} onSaved={(target, count) => {
                setTopic(current => current === topic ? target ?? "" : current);
                setTopicNotice(count ? `已更新 ${count} 条表达的话题。` : "已同步当前话题。");
              }} />}
            {topicNotice && <p className="wordbag-topic-notice" role="status">{topicNotice}</p>}
            <SceneBookmarks />
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
              (active.length === 0 ? (
                <p className="wordbag-state">
                  {topic || familiarity ? "这个筛选下还没有收藏。" : tab === "word"
                    ? "还没有单词，试着加一个吧。"
                    : "还没有收藏句子，去每日金句找找灵感。"}
                </p>
              ) : (
                <ul className="space-y-3">
                  {active.map((w) => {
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
                            {w.id > 0 && familiarityOf(w) === "new" && <span className="wordbag-new-label">待学习</span>}
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
                            <WordReviewContext word={w} showConversation />
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
          {hasCache && <div className="wordbag-scene-link">
            <Link className="ui-link" to="/scenes">去场景里试试 <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>}
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
