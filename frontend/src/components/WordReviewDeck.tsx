import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { checkWordTranslation, prepareWordTranslation, type ReviewChoice, type TranslationGrade, type Word } from "../lib/api";
import { getAuthGeneration } from "../lib/authToken";
import { familiarityOf, matchesReviewAnswer, reviewDueAt, reviewModeForWord, reviewModeLabels, reviewPrompt, type ReviewMode } from "../lib/wordReview";
import { playCafeChime, useRewardEquipped } from "../lib/rewards";
import { createPracticeId } from "../lib/sessionSave";
import { speakText } from "../lib/speech";
import { isWordReviewStale, useWords } from "../store/words";
import { Buddy } from "./Buddy";
import { Button } from "./ui/Button";
import { WordReviewContext } from "./WordReviewContext";
import { WordBagArtwork } from "./WordBagArtwork";

const choiceText = (choice: ReviewChoice) => choice === "uncertain" ? "模糊" : choice ? "熟悉" : "遗忘";
const dateLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ReviewDue({ word }: { word: Word }) {
  if (familiarityOf(word) === "new") return <p className="wordbag-due">待学习 · 定级后安排复习</p>;
  const due = reviewDueAt(word.due_at);
  const label = word.mastered ? "已掌握" : !due || due.getTime() <= Date.now() ? "现在可练" : dateLabel.format(due);
  return <p className="wordbag-due">下次复习 · {label}</p>;
}

type SavedChoice = { word: Word; choice: ReviewChoice; intentId: string; unavailable?: boolean };
type Repetition = { sourceIndex: number; total: 2 | 3 };
type Feedback = { title: string; detail?: string };
const gradeTitles: Record<TranslationGrade["verdict"], string> = { equivalent: "合理改写", partial: "意思接近，可以再改一处", different: "和题意有出入" };

export function WordReviewDeck({ deck, mode, activity = "review", review, onDone }: {
  deck: Word[]; mode: ReviewMode; activity?: "learn" | "review" | "retest";
  review: (word: Word, choice: ReviewChoice, intentId: string) => Promise<void>; onDone: () => void;
}) {
  const learning = activity === "learn";
  const singleRating = activity !== "review";
  const savedWords = useWords(s => s.words);
  const confirmedReceipts = useWords(s => s.confirmedReviewReceipts);
  const chime = useRewardEquipped("cafe-chime");
  const [i, setI] = useState(0);
  const [seen, setSeen] = useState<number | null>(null);
  const [repeats, setRepeats] = useState<Repetition[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [translations, setTranslations] = useState<Map<string, string | null>>(() => new Map());
  const [choices, setChoices] = useState<Map<number, ReviewChoice>>(() => new Map());
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const [failed, setFailed] = useState<SavedChoice[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const deckGeneration = useRef(getAuthGeneration());
  const stepLabel = useRef<HTMLParagraphElement>(null);
  const completionTitle = useRef<HTMLHeadingElement>(null);
  const revealedAnswer = useRef<HTMLElement | null>(null);
  const referencePanel = useRef<HTMLDivElement>(null);
  const answerInput = useRef<HTMLInputElement>(null);
  const returnToInput = useRef(false);
  const checkRequest = useRef<AbortController | null>(null);
  const referenceId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; checkRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    locked.current = false;
    (stepLabel.current ?? completionTitle.current)?.focus({ preventScroll: true });
  }, [i, seen]);
  useEffect(() => {
    if (referenceOpen) {
      revealedAnswer.current?.focus({ preventScroll: true });
      referencePanel.current?.scrollIntoView?.({ block: "nearest" });
    } else if (flipped || feedback) revealedAnswer.current?.focus();
    else if (returnToInput.current) {
      returnToInput.current = false;
      answerInput.current?.focus();
    }
  }, [flipped, referenceOpen, feedback]);
  // Finish everyone's second pass before returning to the forgotten expressions for their third.
  const followups = useMemo(() => [
    ...repeats.map(item => ({ ...item, pass: 2 })),
    ...repeats.filter(item => item.total === 3).map(item => ({ ...item, pass: 3 })),
  ], [repeats]);
  const repeat = i >= deck.length ? followups[i - deck.length] : undefined;
  const sourceIndex = repeat?.sourceIndex ?? i;
  const word = deck[sourceIndex];
  const wordId = word?.id;
  const createdAt = word?.created_at;
  const translationKey = word && JSON.stringify([word.id, word.created_at, word.text]);
  const translation = translationKey === undefined ? undefined : translations.get(translationKey);
  const translationUnavailable = mode === "translate" && translation === null;
  const cardMode = word ? reviewModeForWord(word, translationUnavailable ? "cloze" : mode) : mode;
  const prompt = word && reviewPrompt(translation ? { ...word, review_translation: translation } : word, cardMode);
  const preparing = !!word && cardMode === "translate" && !prompt;
  const preview = learning && seen !== i;
  const practiceOnly = repeat?.pass === 2 && repeat.total === 3;
  const waitForSave = !!word && (pending.has(word.id) || failed.some(item => item.word.id === word.id));
  const showRatings = !preparing && (prompt ? !!feedback : flipped || !singleRating);
  const canAdvance = !!word && !preview && !waitForSave && showRatings && (!repeat || !!prompt || flipped);

  useEffect(() => {
    if (preview || !preparing || wordId === undefined || createdAt === undefined || !translationKey ||
      deckGeneration.current !== getAuthGeneration()) return;
    const controller = new AbortController();
    const prepare = async () => {
      let translation: string | null = null;
      try {
        const result = await prepareWordTranslation(wordId, createdAt, controller.signal);
        const candidate = result.translation?.trim();
        if (candidate && /\p{Script=Han}/u.test(candidate)) translation = candidate;
      } catch { /* A saved expression can still be practiced with a different prompt. */ }
      if (!controller.signal.aborted && deckGeneration.current === getAuthGeneration()) {
        setTranslations(items => new Map(items).set(translationKey, translation));
      }
    };
    void prepare();
    return () => controller.abort();
  }, [createdAt, preparing, preview, translationKey, wordId]);

  async function checkAnswer() {
    const answer = input.trim();
    if (!word || !prompt || !answer || referenceOpen || feedback || checkRequest.current ||
      deckGeneration.current !== getAuthGeneration()) return;
    if (matchesReviewAnswer(answer, prompt.answer)) return setFeedback({ title: "与参考一致" });
    if (cardMode === "cloze") return setFeedback({ title: "与参考填法不同", detail: "可以结合句意判断其他填法。" });
    const controller = new AbortController();
    const current = () => mounted.current && !controller.signal.aborted && deckGeneration.current === getAuthGeneration();
    checkRequest.current = controller;
    setChecking(true);
    try {
      const result = await checkWordTranslation(word.id, answer, controller.signal, word.created_at || undefined);
      if (current()) setFeedback({ title: gradeTitles[result.verdict], detail: result.feedback });
    } catch {
      if (current()) setFeedback({ title: "暂时无法判断改写", detail: "可对照参考答案自行标记熟悉度。" });
    } finally {
      if (checkRequest.current === controller) checkRequest.current = null;
      if (current()) setChecking(false);
    }
  }

  function closeReference() {
    returnToInput.current = true;
    setReferenceOpen(false);
  }

  const nextCard = useCallback(() => {
    checkRequest.current?.abort();
    checkRequest.current = null;
    setChecking(false);
    setFlipped(false);
    setReferenceOpen(false);
    setFeedback(null);
    setInput("");
    setI(i + 1);
  }, [i]);

  function advance() {
    if (locked.current || !canAdvance) return false;
    locked.current = true;
    nextCard();
    return true;
  }

  const finishSavedRating = useCallback((id: number, choice: ReviewChoice) => {
    setChoices(items => new Map(items).set(id, choice));
    if (chime && i + 1 === deck.length) void playCafeChime();
    nextCard();
  }, [chime, deck.length, i, nextCard]);

  useEffect(() => {
    if (activity === "retest" || deckGeneration.current !== getAuthGeneration()) return;
    const recovered = failed.filter(entry => !entry.unavailable && entry.word.id !== retrying
      && confirmedReceipts.has(entry.intentId));
    if (!recovered.length) return;
    setFailed(items => items.filter(item => !recovered.some(entry => entry.intentId === item.intentId)));
    const current = recovered.find(entry => entry.word.id === word?.id && entry.word.created_at === word?.created_at);
    if (singleRating && current) finishSavedRating(current.word.id, current.choice);
  }, [activity, confirmedReceipts, failed, finishSavedRating, retrying, singleRating, word]);

  function recordFailedRating(target: SavedChoice, error: unknown) {
    setFailed(items => [...items.filter(item => item.word.id !== target.word.id),
      { ...target, unavailable: activity !== "retest" && isWordReviewStale(error) }]);
  }

  function answer(choice: ReviewChoice) {
    if (!word || practiceOnly || !canAdvance || locked.current || deckGeneration.current !== getAuthGeneration()) return;
    if (singleRating) locked.current = true;
    else advance();
    const current = () => mounted.current && deckGeneration.current === getAuthGeneration();
    const intentId = createPracticeId();
    const needsMore = !singleRating && !repeat && choice !== true;
    if (needsMore) setRepeats(items => [...items, { sourceIndex, total: choice === false ? 3 : 2 }]);
    if (!singleRating) setChoices(items => new Map(items).set(word.id, choice));
    setPending(items => new Set(items).add(word.id));
    if (!singleRating && chime && !needsMore && i + 1 === deck.length + followups.length) void playCafeChime();
    void Promise.resolve(review(word, choice, intentId)).then(() => {
      if (current() && singleRating) finishSavedRating(word.id, choice);
    }).catch((error: unknown) => {
      if (current()) recordFailedRating({ word, choice, intentId }, error);
    }).finally(() => {
      if (current()) setPending(items => {
        const remaining = new Set(items);
        remaining.delete(word.id);
        return remaining;
      });
    });
  }

  async function retrySave(target: SavedChoice) {
    if (retrying !== null || deckGeneration.current !== getAuthGeneration()) return;
    const current = () => mounted.current && deckGeneration.current === getAuthGeneration();
    setRetrying(target.word.id);
    try {
      await review(target.word, target.choice, target.intentId);
      if (current()) {
        setFailed(items => items.filter(item => item.word.id !== target.word.id));
        if (singleRating) finishSavedRating(target.word.id, target.choice);
      }
    } catch (error) { if (current()) recordFailedRating(target, error); }
    finally { if (current()) setRetrying(null); }
  }

  const saveStatus = <>
    {pending.size > 0 && <p role="status">{singleRating ? "正在保存熟悉度…" : "正在后台保存复习…"}</p>}
    {failed.map(item => <div key={item.word.id} role="alert" className="wordbag-save-error">
      {item.unavailable ? <>
        <span>「{item.word.text}」已更新，原卡片的标记不能保存。</span>
        {word?.id === item.word.id && <Button onClick={nextCard}>跳过这条</Button>}
      </> : <>
        <span>「{item.word.text}」的{choiceText(item.choice)}标记尚未确认保存。</span>
        <Button disabled={retrying !== null} onClick={() => void retrySave(item)}>重试保存</Button>
      </>}
    </div>)}
  </>;
  if (!word) {
    const remembered = [...choices.values()].filter(choice => choice === true).length;
    const uncertain = [...choices.values()].filter(choice => choice === "uncertain").length;
    return <section className="card grid place-items-center gap-3 p-8 text-center">
      <Buddy mood="cheer" size={120} />
      <h3 className="font-display text-xl font-semibold text-ink" ref={completionTitle} tabIndex={-1}>{learning ? "学习完成！" : "复习完成！"}</h3>
      <p className="text-sm text-muted">记得 {remembered} · 待加强 {choices.size - remembered}</p>
      <p className="text-xs text-muted">熟悉 {remembered} · 模糊 {uncertain} · 遗忘 {choices.size - remembered - uncertain}</p>
      <ul className="wordbag-review-dates">{deck.map(entry => {
        const stored = savedWords.find(candidate => candidate.id === entry.id && candidate.created_at === entry.created_at && candidate.text === entry.text);
        return stored && !pending.has(entry.id) && !failed.some(item => item.word.id === entry.id) &&
          <li key={entry.id}><strong lang="en">{entry.text}</strong><ReviewDue word={stored} /></li>;
      })}</ul>
      {saveStatus}
      <Button onClick={onDone}>回到列表</Button>
    </section>;
  }

  const step = (
    <p className="wordbag-attempt" ref={stepLabel} tabIndex={-1}>
      {singleRating && <strong>{preview ? "先学这条" : "回忆与定级"}</strong>}
      {activity !== "retest" && <span>第 {sourceIndex + 1} / {deck.length} 条</span>}
      {repeat && <span className="wordbag-repeat">{repeat.total === 3 ? "遗忘巩固" : "模糊巩固"} · 第 {repeat.pass} / {repeat.total} 遍</span>}
    </p>
  );
  if (preview) return <section className="card wordbag-learn" aria-label="学习新收藏">
    {step}
    <WordBagArtwork scenarioId={word.scenario_id} compact />
    <WordReviewContext word={word} showConversation />
    <div className="wordbag-learn-expression">
      <h3 lang="en">{word.text}</h3>
      {word.meaning && <p>{word.meaning}</p>}
      {word.example.trim() && word.example.trim() !== word.text.trim() && <p className="wordbag-learn-example" lang="en">{word.example}</p>}
    </div>
    <div className="wordbag-learn-controls">
      <Button variant="soft" onClick={() => speakText(word.text, word.scenario_id)}><Volume2 size={16} /> 朗读</Button>
      <Button onClick={() => setSeen(i)}>试着回忆</Button>
    </div>
  </section>;

  return <section className="card wordbag-question grid place-items-center gap-4 p-8 text-center"
    onKeyDown={event => {
      if (referenceOpen && event.key === "Escape") {
        event.preventDefault();
        closeReference();
      }
    }}>
    {step}
    <WordBagArtwork scenarioId={word.scenario_id} compact />
    <WordReviewContext key={i} word={word} showConversation={flipped || referenceOpen || !!feedback}
      hiddenAnswers={flipped || referenceOpen || feedback ? [] : [word.text, prompt?.answer ?? ""]} />
    <div className="wordbag-card-mode">
      <p>{reviewModeLabels[cardMode]}</p>
      {translationUnavailable && <p>这次未能准备中文题面。</p>}
    </div>
    {preparing ? <p className="wordbag-review-status" role="status">正在准备中文题面…</p> :
      prompt ? <form className="wordbag-review-output" onSubmit={event => { event.preventDefault(); void checkAnswer(); }}>
      <p className="wordbag-review-prompt" lang={cardMode === "cloze" ? "en" : "zh-CN"}>{prompt.prompt}</p>
      <label>输入英文<input ref={answerInput} value={input} disabled={referenceOpen} readOnly={!!feedback || checking}
        onChange={event => setInput(event.target.value)} lang="en" maxLength={1200} enterKeyHint="done" autoComplete="off" spellCheck={false} /></label>
      {!feedback && !referenceOpen && <div className="wordbag-output-actions">
        <Button type="submit" disabled={!input.trim() || checking}>检查答案</Button>
        <Button type="button" variant="ghost" aria-expanded={false} aria-controls={referenceId}
          disabled={checking} onClick={() => setReferenceOpen(true)}>查看参考</Button>
      </div>}
      <div ref={referencePanel} id={referenceId} hidden={!referenceOpen} className="wordbag-reference-panel">
        {referenceOpen && <>
          <div><strong>参考答案</strong><p className="wordbag-reference" ref={element => { revealedAnswer.current = element; }}
            tabIndex={-1} lang="en">{prompt.answer}</p></div>
          <Button type="button" variant="soft" onClick={closeReference}>关闭参考</Button>
        </>}
      </div>
      {checking && <p role="status">正在判断表达是否和题意一致…</p>}
      {feedback && <div role="status"><strong>{feedback.title}</strong>{feedback.detail && <p>{feedback.detail}</p>}
        <p className="wordbag-reference" ref={element => { revealedAnswer.current = element; }} tabIndex={-1} lang="en">{prompt.answer}</p>
      </div>}
    </form> : singleRating ? <div className="wordbag-learn-recall">
      <p>{word.meaning || (learning ? "想一想刚学的英文，再核对原文。" : "回忆这条收藏，再核对原文。")}</p>
      {flipped ? <strong ref={revealedAnswer} tabIndex={-1} lang="en">{word.text}</strong> : <Button variant="soft" onClick={() => setFlipped(true)}>显示原文</Button>}
    </div> : <button type="button" onClick={() => setFlipped(value => !value)}
      className="grid min-h-[9rem] w-full place-items-center rounded-3xl bg-surface-2 px-6 py-8">
      {!flipped ? <span className="font-display text-2xl font-bold text-ink">{word.text}</span> : <div>
        <p className="text-lg text-ink">{word.meaning || "（暂无释义）"}</p>
        {word.example && <p className="mt-2 text-sm text-muted">{word.example}</p>}
      </div>}
    </button>}
    {showRatings && <>
      <div className="flex items-center gap-3"><button type="button" onClick={() => speakText(word.text)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink">
        <Volume2 className="h-3.5 w-3.5" /> 朗读</button>
        {!singleRating && !prompt && <span className="text-xs text-muted">点卡片翻面看释义</span>}</div>
      <div className="flex flex-wrap justify-center gap-2">
        {practiceOnly ? <Button disabled={!canAdvance} onClick={advance}>完成这遍</Button> : <>
          <Button variant="soft" disabled={!canAdvance} onClick={() => answer(false)}>遗忘（忘了）</Button>
          <Button variant="soft" disabled={!canAdvance} onClick={() => answer("uncertain")}>模糊</Button>
          <Button disabled={!canAdvance} onClick={() => answer(true)}>熟悉（记得）</Button>
        </>}
      </div>
    </>}
    {saveStatus}
  </section>;
}
