import { ArrowRight, Check, Languages, PencilLine, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, type Correction } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { buildCorrectionDrill, matchesBlank } from "../lib/correctionDrill";
import { checkCorrectionTranslation, translateCorrection, type PracticeResult } from "../lib/correctionPracticeApi";
import type { ReplaySentence } from "../lib/practiceCorrections";
import "./QuickCorrectionPractice.css";

type Mode = "translate" | "cloze";
type Drill = NonNullable<ReturnType<typeof buildCorrectionDrill>>;

export function QuickCorrectionPractice({ example, correction, children, selected = true, fragmentOnly = false, onOpen }: {
  example: ReplaySentence;
  correction: Correction;
  children?: ReactNode;
  selected?: boolean;
  fragmentOnly?: boolean;
  onOpen?: () => void;
}) {
  const drill = useMemo(() => buildCorrectionDrill(example, correction), [example, correction]);
  if (!drill) return <>{children}</>;
  const fragment = fragmentOnly || drill.fragment;
  return <Practice key={JSON.stringify([drill.exercise, drill.prompt, fragment])} drill={drill} fragment={fragment} selected={selected} onOpen={onOpen}>
    {children}
  </Practice>;
}

function Practice({ drill, children, selected, fragment, onOpen }: {
  drill: Drill;
  children?: ReactNode;
  selected: boolean;
  fragment: boolean;
  onOpen?: () => void;
}) {
  const id = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [chinese, setChinese] = useState("");
  const [translationUnavailable, setTranslationUnavailable] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [error, setError] = useState("");
  const [ownerChanged, setOwnerChanged] = useState(false);
  const owner = useRef(getAuthGeneration()).current;
  const active = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const clozeButton = useRef<HTMLButtonElement>(null);
  const articleFocus = drill.exercise.focus.category === "articles";
  const reorder = mode === "cloze" && drill.wordChoices.length > 0;

  useEffect(() => {
    const unsubscribe = subscribeAuthGeneration(() => { active.current?.abort(); setOwnerChanged(true); });
    return () => { unsubscribe(); active.current?.abort(); };
  }, []);
  useEffect(() => {
    if (mode === "cloze" || (mode === "translate" && chinese)) input.current?.focus();
  }, [mode, chinese]);
  useEffect(() => {
    if (!selected) { cancel(); setMode(null); }
  }, [selected]);

  function cancel() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setError("");
    setResult(null);
    setAnswer("");
  }

  async function request<T,>(work: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void, fail: (cause: unknown) => void) {
    if (owner !== getAuthGeneration() || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const current = () => active.current === controller && !controller.signal.aborted && owner === getAuthGeneration();
    setBusy(true);
    setError("");
    try {
      const data = await work(controller.signal);
      if (current()) accept(data);
    } catch (cause) {
      if (current()) fail(cause);
    } finally {
      if (current()) { active.current = null; setBusy(false); }
    }
  }

  function loadChinese() {
    void request(signal => translateCorrection(drill.exercise, signal), data => setChinese(data.chinese), cause => {
      if (cause instanceof ApiError && cause.status === 422 && cause.code === "translation_prompt_ambiguous") {
        setTranslationUnavailable(true);
        opener.current = clozeButton.current;
        setMode("cloze");
      } else {
        setError("中文题面暂时没能生成。");
      }
    });
  }

  function close() {
    cancel();
    setMode(null);
    opener.current?.focus();
  }

  function open(next: Mode, button: HTMLButtonElement) {
    if (owner !== getAuthGeneration()) return;
    if (next === mode) { close(); return; }
    cancel();
    opener.current = button;
    onOpen?.();
    setMode(next);
    if (next === "translate" && !chinese && !translationUnavailable) loadChinese();
  }

  function check(text: string) {
    if (owner !== getAuthGeneration() || active.current) return;
    setError("");
    if (mode === "cloze") {
      const correct = matchesBlank(text, drill.answer, drill.caseSensitive);
      setResult({ correct, feedback: correct ? "这处用法填对了。" : "看看空格前后的词，再试一种填法。" });
    } else if (mode === "translate" && chinese && text.trim()) {
      setResult(null);
      void request(signal => checkCorrectionTranslation(drill.exercise, chinese, text.trim(), signal), setResult,
        () => setError("这次没能检查，保留了你的译文。请再试一次。"));
    }
  }

  if (ownerChanged) return null;
  return <div className="quick-practice" onKeyDown={event => {
    if (mode && event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
  }}>
    {children && <div className="quick-practice-summary" hidden={mode !== null}>{children}</div>}
    <div className="quick-practice-tools print:hidden">
      {!fragment && !translationUnavailable && drill.exercise.reference.trim() && <button type="button" aria-expanded={mode === "translate"} aria-controls={id}
        onClick={event => open("translate", event.currentTarget)}><Languages size={15} aria-hidden="true" />中译英</button>}
      <button ref={clozeButton} type="button" aria-expanded={mode === "cloze"} aria-controls={id}
        onClick={event => open("cloze", event.currentTarget)}><PencilLine size={15} aria-hidden="true" />填空</button>
    </div>
    {mode && <section className="quick-practice-panel print:hidden" id={id} aria-label={mode === "translate" ? "中译英练习" : "填空练习"}>
      <button className="quick-practice-close" type="button" onClick={close} aria-label="收起练习"><X size={17} /></button>
      {fragment && <p className="quick-practice-scope">练习保存的纠错片段</p>}
      {mode === "cloze" && translationUnavailable && <p className="quick-practice-scope" role="status">
        {articleFocus ? "中文题面缺少区分冠词的线索，已切换为填空。" : "中文题面无法区分这处改动，已切换为填空。"}
      </p>}
      {mode === "translate" && !chinese ? <>
        {busy && <p role="status">正在准备中文题面…</p>}
        {error && <p role="alert">{error} <button type="button" className="coaching-secondary" onClick={loadChinese}>重新加载题目</button></p>}
      </> : <>
        <p className="quick-practice-prompt" id={id + "-prompt"} lang={mode === "cloze" ? "en" : "zh-CN"}>
          {mode === "cloze" ? drill.prompt : chinese}
        </p>
        {reorder && <p className="quick-practice-scope" id={id + "-order"}>
          把这些词按正确顺序填入空格 <span lang="en">{drill.wordChoices.join(" / ")}</span>
        </p>}
        <form aria-busy={busy} onSubmit={event => { event.preventDefault(); if (answer.trim()) check(answer); }}>
          <label htmlFor={id + "-answer"}>{mode === "cloze" ? "填入英文" : "你的英文译文"}</label>
          <input ref={input} id={id + "-answer"} lang="en" value={answer} readOnly={busy}
            aria-describedby={reorder ? `${id}-prompt ${id}-order` : id + "-prompt"} autoComplete="off" maxLength={4000}
            onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }}
            onChange={event => { setAnswer(event.target.value); setResult(null); setError(""); }} />
          <div className="quick-practice-actions">
            <button className="coaching-primary" type="submit" disabled={!answer.trim() || busy}>
              {busy ? "检查中…" : "检查答案"}<ArrowRight size={15} aria-hidden="true" />
            </button>
            {mode === "cloze" && <button className="coaching-secondary" type="button"
              onClick={() => { setAnswer(""); check(""); }}>此处无需填词</button>}
          </div>
        </form>
        {error && <p role="alert" className="replay-error">{error}</p>}
        {result && <div className={`replay-result${result.correct ? "" : " replay-result-retry"}`} role="status">
          <strong>{result.correct && <Check size={15} />}{result.correct ? "答对了" : "再试一次"}</strong>
          <p>{result.feedback}</p>
          <details className="replay-reference"><summary>{fragment ? "查看参考片段" : "查看参考答案"}</summary>
            {drill.exercise.reference ? <p lang="en">{drill.exercise.reference}</p> : <p>删去这段文字。</p>}
          </details>
        </div>}
      </>}
    </section>}
  </div>;
}
