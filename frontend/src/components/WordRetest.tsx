import { useEffect, useRef, useState } from "react";
import { ApiError, getWordRetest, startWordRetest, type ReviewChoice, type WordRetestState } from "../lib/api";
import { getAuthGeneration } from "../lib/authToken";
import { reviewPrompt } from "../lib/wordReview";
import { useWords } from "../store/words";
import { WordReviewDeck } from "./WordReviewDeck";
import { WordBagArtwork, WordBagMotionProvider } from "./WordBagArtwork";

type Focus = "uncertain" | "forgot";

type RetestProps = { onClose: () => void; onFocus: (focus: Focus) => void };

export function WordRetest(props: RetestProps) {
  return <WordBagMotionProvider><WordRetestContent {...props} /></WordBagMotionProvider>;
}

function WordRetestContent({ onClose, onFocus }: RetestProps) {
  const [state, setState] = useState<WordRetestState | null>(null);
  const [includeScene, setIncludeScene] = useState(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [scopePending, setScopePending] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const active = useRef(false);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const generation = useRef(getAuthGeneration());
  const current = () => active.current && generation.current === getAuthGeneration();

  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    getWordRetest(controller.signal).then(result => {
      if (!controller.signal.aborted && generation.current === getAuthGeneration()) setState(result);
    }).catch(() => {
      if (!controller.signal.aborted && generation.current === getAuthGeneration()) setError("暂时无法读取重测进度。");
    });
    return () => { active.current = false; controller.abort(); };
  }, [attempt]);

  const round = state?.round;
  const item = round?.next_item;
  const rated = round ? round.familiar + round.uncertain + round.forgot : 0;
  const total = round ? round.words + round.sentences : 0;
  const continueRound = Boolean(item);
  const sceneCount = includeScene ? state?.unadded_scene ?? 0 : 0;
  const completed = Boolean(round && !item);

  useEffect(() => { pageHeading.current?.focus(); }, []);
  useEffect(() => {
    if (running && completed) resultHeading.current?.focus();
  }, [running, completed]);

  async function refreshScope(completedId: string) {
    setScopePending(true);
    setScopeError(false);
    try {
      const latest = await getWordRetest();
      if (!current()) return;
      setState(previous => previous?.round?.id === completedId ? latest : previous);
      if (latest.round?.id !== completedId) setRunning(false);
    } catch {
      if (current()) setScopeError(true);
    } finally {
      if (current()) setScopePending(false);
    }
  }

  async function start() {
    if (!state || starting || !current()) return;
    setStarting(true);
    setError("");
    try {
      const result = await startWordRetest(includeScene, round?.id);
      if (!current()) return;
      setState(previous => previous && { ...previous, round: result });
      setIncludeScene(false);
      setRunning(true);
      if (!result.next_item) void refreshScope(result.id);
    } catch (cause) {
      if (current()) setError(cause instanceof ApiError && cause.status === 422 ? cause.message : "暂时无法开始重测，请重试。");
    } finally {
      if (current()) setStarting(false);
    }
  }

  async function rate(choice: ReviewChoice) {
    if (!round || !item || !current()) throw new DOMException("Identity changed", "AbortError");
    try {
      const saved = await useWords.getState().rateRetest(item.word, round.id, item.position, choice);
      if (current()) {
        setState(previous => previous && { ...previous, round: saved });
        if (!saved.next_item) void refreshScope(saved.id);
      }
    } catch (cause) {
      if (!(cause instanceof ApiError) || ![404, 409].includes(cause.status) || !current()) throw cause;
      const refreshed = await getWordRetest();
      if (current()) {
        setState(refreshed);
        setError("重测进度已在另一处更新，已同步最新题目。");
      }
    }
  }

  return <section className="wordbag-retest" aria-label="重测已有收藏">
    <div className="wordbag-retest-intro">
      <h1 ref={pageHeading} tabIndex={-1}>重测已有收藏</h1>
      {round ? <>
        <p>本轮 · {round.words} 条单词与短语 · {round.sentences} 句收藏</p>
        <p role="status">已测 {rated} / {total} 条{round.skipped > 0 && ` · 已跳过 ${round.skipped} 条删除的收藏`}</p>
        <progress value={rated + round.skipped} max={Math.max(total, 1)} aria-label="本轮重测进度" />
      </> : null}
    </div>
    {error && <p role="alert" className="wordbag-retest-error">{error}</p>}
    {!state ? error ? <button type="button" className="ui-secondary" onClick={() => { setError(""); setAttempt(n => n + 1); }}>重试读取</button>
      : <p role="status">正在读取收藏和重测进度…</p> : <>
      {round && !item && <div className="wordbag-retest-result">
        <h3 ref={resultHeading} tabIndex={-1}>重测完成</h3>
        <dl><div><dt>熟悉</dt><dd>{round.familiar}</dd></div><div><dt>模糊</dt><dd>{round.uncertain}</dd></div><div><dt>遗忘</dt><dd>{round.forgot}</dd></div></dl>
        <div className="wordbag-retest-actions">
          {round.forgot > 0 && <button type="button" className="ui-secondary" onClick={() => onFocus("forgot")}>查看遗忘的表达</button>}
          {round.uncertain > 0 && <button type="button" className="ui-secondary" onClick={() => onFocus("uncertain")}>查看模糊的表达</button>}
        </div>
      </div>}
      {round && item && running ? <WordReviewDeck key={`${round.id}:${item.position}`} deck={[item.word]} activity="retest"
        mode={reviewPrompt(item.word, "translate") ? "translate" : reviewPrompt(item.word, "cloze") ? "cloze" : "flip"}
        review={(_word, choice) => rate(choice)} onDone={onClose} /> : <div className="wordbag-retest-prep">
          <div className="wordbag-retest-options">
            {continueRound ? <p>沿用本轮已选的收藏。后来加入的表达会进下一轮。</p>
              : scopePending ? <p role="status">正在读取当前收藏…</p>
              : scopeError && round ? <p role="alert">暂时无法确认下一轮范围。 <button type="button" className="ui-link" onClick={() => void refreshScope(round.id)}>重试</button></p>
              : <>
                {round && <h2 className="wordbag-round-size">下一轮范围</h2>}
                <p className="wordbag-round-size" role="status">共 {state.words + state.sentences + sceneCount} 条</p>
                <p>{state.words} 条单词与短语 · {state.sentences + sceneCount} 句收藏</p>
                <p>包含已掌握和未到期的表达。</p>
                {state.unadded_scene > 0 && <label><input type="checkbox" checked={includeScene}
                  onChange={event => setIncludeScene(event.target.checked)} disabled={starting} /> 将 {state.unadded_scene} 条场景收藏加入生词本并纳入重测</label>}
              </>}
            <button type="button" className="ui-button" disabled={starting || scopePending || scopeError || (!continueRound && !state.words && !state.sentences && !includeScene)}
              onClick={() => continueRound ? setRunning(true) : void start()}>
              {starting ? "正在准备…" : continueRound ? "继续重测" : round ? "开始新一轮" : "开始重测"}
            </button>
          </div>
          <WordBagArtwork compact />
        </div>}
    </>}
  </section>;
}
