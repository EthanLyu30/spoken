import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { checkWordTranslation, type ReviewChoice, type TranslationGrade, type Word } from "../lib/api";
import { getAuthGeneration } from "../lib/authToken";
import { matchesReviewAnswer, reviewDueAt, reviewPrompt, type ReviewMode } from "../lib/wordReview";
import { playCafeChime, useRewardEquipped } from "../lib/rewards";
import { speakText } from "../lib/speech";
import { useWords } from "../store/words";
import { Buddy } from "./Buddy";
import { Button } from "./ui/Button";

const choiceText = (choice: ReviewChoice) => choice === "uncertain" ? "模糊" : choice ? "熟悉" : "遗忘";
const dateLabel = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export function ReviewDue({ word }: { word: Word }) {
  const due = reviewDueAt(word.due_at);
  const label = word.mastered ? "已掌握" : !due || due.getTime() <= Date.now() ? "现在可练" : dateLabel.format(due);
  return <p className="wordbag-due">下次复习 · {label}</p>;
}

type SavedChoice = { id: number; choice: ReviewChoice };
type Feedback = { title: string; detail?: string };
const gradeTitles: Record<TranslationGrade["verdict"], string> = { equivalent: "合理改写", partial: "意思接近，可以再改一处", different: "和题意有出入" };

export function WordReviewDeck({ deck, mode, review, onDone }: {
  deck: Word[]; mode: ReviewMode; review: (id: number, choice: ReviewChoice) => Promise<void>; onDone: () => void;
}) {
  const savedWords = useWords(s => s.words);
  const chime = useRewardEquipped("cafe-chime");
  const [i, setI] = useState(0);
  const [repeats, setRepeats] = useState<Word[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [choices, setChoices] = useState<Map<number, ReviewChoice>>(() => new Map());
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const [failed, setFailed] = useState<SavedChoice[]>([]);
  const [retrying, setRetrying] = useState<number | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const checkRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; checkRequest.current?.abort(); };
  }, []);
  useEffect(() => { locked.current = false; }, [i]);
  const repeated = i >= deck.length;
  const word = repeated ? repeats[i - deck.length] : deck[i];
  const prompt = word && reviewPrompt(word, mode);

  function finishCheck(next: Feedback) {
    setFeedback(next);
    setFlipped(true);
  }

  async function checkAnswer() {
    if (!word || !prompt || !input.trim() || checkRequest.current) return;
    if (matchesReviewAnswer(input, prompt.answer)) return finishCheck({ title: "与参考一致" });
    if (mode !== "translate") return finishCheck({ title: "与参考填法不同", detail: "可以结合句意判断其他填法。" });
    const controller = new AbortController();
    const generation = getAuthGeneration();
    const current = () => mounted.current && !controller.signal.aborted && generation === getAuthGeneration();
    checkRequest.current = controller;
    setChecking(true);
    try {
      const result = await checkWordTranslation(word.id, input.trim(), controller.signal);
      if (current()) finishCheck({ title: gradeTitles[result.verdict], detail: result.feedback });
    } catch {
      if (current()) finishCheck({ title: "暂时无法判断改写", detail: "可对照参考答案自行标记熟悉度。" });
    } finally {
      if (checkRequest.current === controller) checkRequest.current = null;
      if (current()) setChecking(false);
    }
  }

  function revealReference() {
    checkRequest.current?.abort();
    checkRequest.current = null;
    setChecking(false);
    finishCheck({ title: "参考答案" });
  }

  function answer(choice: ReviewChoice) {
    if (!word || locked.current || pending.has(word.id) || failed.some(item => item.id === word.id)) return;
    locked.current = true;
    const generation = getAuthGeneration();
    const current = () => mounted.current && generation === getAuthGeneration();
    const again = choice === false && !repeated;
    if (again) setRepeats(items => [...items, word]);
    setChoices(items => new Map(items).set(word.id, choice));
    setPending(items => new Set(items).add(word.id));
    setFlipped(false);
    setFeedback(null);
    setInput("");
    setI(i + 1);
    if (chime && !again && i + 1 === deck.length + repeats.length) void playCafeChime();
    void Promise.resolve(review(word.id, choice)).catch((error: unknown) => {
      if (!current()) return;
      const prior = error && typeof error === "object" && "remembered" in error ? error.remembered : undefined;
      const choiceToSave = typeof prior === "boolean" || prior === "uncertain" ? prior : choice;
      setFailed(items => [...items, { id: word.id, choice: choiceToSave }]);
    }).finally(() => {
      if (current()) setPending(items => {
        const remaining = new Set(items);
        remaining.delete(word.id);
        return remaining;
      });
    });
  }

  async function retrySave(target: SavedChoice) {
    if (retrying !== null) return;
    const generation = getAuthGeneration();
    const current = () => mounted.current && generation === getAuthGeneration();
    setRetrying(target.id);
    try {
      await review(target.id, target.choice);
      if (current()) setFailed(items => items.filter(item => item.id !== target.id));
    } catch { /* The original receipt remains retryable. */ }
    finally { if (current()) setRetrying(null); }
  }

  const saveStatus = <>
    {pending.size > 0 && <p role="status">正在后台保存复习…</p>}
    {failed.map(item => <div key={item.id} role="alert" className="wordbag-save-error">
      <span>「{deck.find(entry => entry.id === item.id)?.text}」的{choiceText(item.choice)}标记尚未确认保存。</span>
      <Button disabled={retrying !== null} onClick={() => void retrySave(item)}>重试保存</Button>
    </div>)}
  </>;
  if (!word) {
    const remembered = [...choices.values()].filter(choice => choice === true).length;
    const uncertain = [...choices.values()].filter(choice => choice === "uncertain").length;
    return <section className="card grid place-items-center gap-3 p-8 text-center">
      <Buddy mood="cheer" size={120} />
      <h3 className="font-display text-xl font-semibold text-ink">复习完成！</h3>
      <p className="text-sm text-muted">记得 {remembered} · 待加强 {choices.size - remembered}</p>
      <p className="text-xs text-muted">熟悉 {remembered} · 模糊 {uncertain} · 遗忘 {choices.size - remembered - uncertain}</p>
      <ul className="wordbag-review-dates">{deck.map(entry => {
        const stored = savedWords.find(candidate => candidate.id === entry.id);
        return stored && !pending.has(entry.id) && !failed.some(item => item.id === entry.id) &&
          <li key={entry.id}><strong lang="en">{entry.text}</strong><ReviewDue word={stored} /></li>;
      })}</ul>
      {saveStatus}
      <Button onClick={onDone}>回到列表</Button>
    </section>;
  }

  const waitForSave = pending.has(word.id) || failed.some(item => item.id === word.id);
  return <section className="card grid place-items-center gap-4 p-8 text-center">
    <p className="text-xs font-bold tracking-wide text-muted">{i + 1} / {deck.length + repeats.length}</p>
    {repeated && <p className="wordbag-repeat">刚才忘记的表达，再练一次</p>}
    {prompt ? <form className="wordbag-review-output" onSubmit={event => { event.preventDefault(); if (!flipped) void checkAnswer(); }}>
      <p lang={mode === "cloze" ? "en" : "zh-CN"}>{prompt.prompt}</p>
      <label>输入英文<input value={input} readOnly={flipped || checking} onChange={event => setInput(event.target.value)} lang="en" maxLength={1200} /></label>
      {!flipped && <div><Button type="submit" disabled={!input.trim() || checking}>检查答案</Button>{" "}
        <Button type="button" variant="soft" onClick={revealReference}>查看参考</Button></div>}
      {checking && <p role="status">正在判断表达是否和题意一致…</p>}
      {feedback && <div role="status"><strong>{feedback.title}</strong>{feedback.detail && <p>{feedback.detail}</p>}
        <p className="wordbag-reference" lang="en">{prompt.answer}</p></div>}
    </form> : <button type="button" onClick={() => setFlipped(value => !value)}
      className="grid min-h-[9rem] w-full place-items-center rounded-3xl bg-surface-2 px-6 py-8">
      {!flipped ? <span className="font-display text-2xl font-bold text-ink">{word.text}</span> : <div>
        <p className="text-lg text-ink">{word.meaning || "（暂无释义）"}</p>
        {word.example && <p className="mt-2 text-sm text-muted">{word.example}</p>}
      </div>}
    </button>}
    {(!prompt || flipped) && <>
      <div className="flex items-center gap-3"><button type="button" onClick={() => speakText(word.text)}
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink">
        <Volume2 className="h-3.5 w-3.5" /> 朗读</button>
        {!prompt && <span className="text-xs text-muted">点卡片翻面看释义</span>}</div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="soft" disabled={waitForSave} onClick={() => answer(false)}>遗忘（忘了）</Button>
        <Button variant="soft" disabled={waitForSave} onClick={() => answer("uncertain")}>模糊</Button>
        <Button disabled={waitForSave} onClick={() => answer(true)}>熟悉（记得）</Button>
      </div>
    </>}
    {saveStatus}
  </section>;
}
