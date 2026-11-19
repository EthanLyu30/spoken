import { ArrowRight, CheckCircle2, LoaderCircle, Mic, Square, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { usePracticePlayback } from "../hooks/usePracticePlayback";
import { postAsr, postTurnCorrection, type CustomScene, type PracticeExercise, type TurnCorrectionResponse } from "../lib/api";
import { ASR_QUOTA_MESSAGE, isAsrQuotaError } from "../lib/asrQuota";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { replayReference, type ReplaySentence } from "../lib/practiceCorrections";
import { startRecording, type ActiveRecorder } from "../lib/recorder";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";

type Props = {
  scenarioId: string;
  custom?: CustomScene;
  hidden?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onPass?: () => void;
  questionRef?: Ref<HTMLHeadingElement>;
} & ({ example: ReplaySentence; exercise?: never } | { exercise: PracticeExercise; example?: never });

export function SentenceReplay({ example, exercise, scenarioId, custom, hidden, onBusyChange, onPass, questionRef }: Props) {
  const inputId = useId();
  const [attempt, setAttempt] = useState("");
  const [mode, setMode] = useState<"idle" | "opening" | "recording" | "transcribing" | "checking">("idle");
  const [result, setResult] = useState<TurnCorrectionResponse | null>(null);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const recorder = useRef<ActiveRecorder | null>(null);
  const { phase, stop: stopPlayback, toggle: togglePlayback } = usePracticePlayback(scenarioId);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(getAuthGeneration()).current;
  const partnerLine = exercise?.partner_line ?? example?.previous_partner_message;
  const reference = exercise ? (result?.task_met === false ? result.suggestion : exercise.example)
    : example && replayReference(example);

  useEffect(() => {
    function cancel() {
      active.current?.abort();
      stopPlayback();
      if (timer.current !== null) clearTimeout(timer.current);
      recorder.current = null;
    }
    const unsubscribe = subscribeAuthGeneration(cancel);
    return () => { unsubscribe(); cancel(); };
  }, [stopPlayback]);
  useEffect(() => { if (hidden) stopPlayback(); }, [hidden, stopPlayback]);

  function isCurrent(controller: AbortController) {
    return active.current === controller && !controller.signal.aborted && generation === getAuthGeneration();
  }

  function done(controller: AbortController) {
    if (isCurrent(controller)) {
      active.current = null;
      setMode("idle");
      onBusyChange?.(false);
    }
  }

  async function stopRecording() {
    const controller = active.current;
    const recording = recorder.current;
    if (!controller || !recording || !isCurrent(controller)) return;
    recorder.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    setMode("transcribing");
    try {
      const pcm = await recording.stop();
      if (!isCurrent(controller)) return;
      const text = (await postAsr(pcm, controller.signal)).trim();
      if (isCurrent(controller)) {
        if (text) setAttempt(text.slice(0, 600));
        else setError("没有听清这一句，可以再录一次或直接输入。");
      }
    } catch (error) {
      if (isCurrent(controller)) setError(isAsrQuotaError(error) ? ASR_QUOTA_MESSAGE : "语音转写失败，可以再录一次或直接输入。");
    } finally { done(controller); }
  }

  async function record() {
    if (active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    active.current = controller;
    stopPlayback();
    setError("");
    setResult(null);
    setMode("opening");
    onBusyChange?.(true);
    try {
      const recording = await startRecording(undefined, controller.signal);
      if (!isCurrent(controller)) { controller.abort(); return; }
      recorder.current = recording;
      setMode("recording");
      timer.current = setTimeout(() => void stopRecording(), 30_000);
    } catch {
      if (isCurrent(controller)) setError("无法打开麦克风，也可以直接输入。");
      done(controller);
    }
  }

  async function check() {
    const text = attempt.trim();
    if (!text || active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    active.current = controller;
    setError("");
    setResult(null);
    setMode("checking");
    onBusyChange?.(true);
    try {
      const response = await postTurnCorrection({ scenario_id: scenarioId, custom, text,
        previous_partner_message: partnerLine?.slice(0, 600) ?? "", replay_original: example?.original,
        practice_exercise: exercise,
      }, controller.signal);
      if (isCurrent(controller)) {
        setResult(response);
        if (response.task_met === true) onPass?.();
      }
    } catch {
      if (isCurrent(controller)) setError("这次没能检查，请重试。你的作答还在。");
    } finally { done(controller); }
  }

  return (
    <div className="sentence-replay" data-mode={mode}>
      <div className="replay-prompt">
        {exercise ? <>
          <div className="guided-question" data-playback={phase ?? undefined}>
            <button type="button" className="guided-listen" aria-label={phase ? "停止朗读 Pip 的提问" : "听 Pip 的提问"}
              disabled={mode !== "idle"} onClick={() => togglePlayback("question", exercise.partner_line)}>
              {phase ? <Square size={15} /> : <Volume2 size={17} />} Pip 的提问
            </button>
            <h2 className="guided-line" ref={questionRef} tabIndex={-1} lang="en">{exercise.partner_line}</h2>
          </div>
          <p className="guided-task" id={`${inputId}-task`}>{exercise.task}</p>
          {exercise.target && <p className="guided-target" id={`${inputId}-target`}>{exercise.target.instruction}</p>}
          <details className="replay-reference guided-hint"><summary>看句型提示</summary><p lang="en">{exercise.hint}</p></details>
        </> : <>
          {partnerLine && <p className="replay-context"><span>当时 Pip 问</span><q lang="en">{partnerLine}</q></p>}
          <p className="replay-original"><span>你当时说</span><q lang="en">{example?.original}</q></p>
        </>}
      </div>
      <div className="replay-response">
        <form aria-busy={mode === "checking" || mode === "transcribing"} onSubmit={(event) => { event.preventDefault(); void check(); }}>
          <label htmlFor={inputId}>{exercise ? "用英语回答" : "这次的说法"}</label>
          <textarea id={inputId} lang="en" rows={2} maxLength={600} value={attempt} disabled={mode !== "idle"}
            aria-describedby={exercise ? `${inputId}-task${exercise.target ? ` ${inputId}-target` : ""}` : undefined}
            onChange={(event) => { setAttempt(event.target.value); setResult(null); }}
            placeholder={exercise ? "录一句，或在这里输入" : "保留原意，再说一遍"} />
          <div className="replay-actions">
            <button className="coaching-secondary replay-record" type="button" disabled={mode !== "idle" && mode !== "recording"}
              onClick={mode === "recording" ? stopRecording : record}>
              {mode === "recording" ? <span className="replay-record-dot" aria-hidden="true" /> : <Mic size={16} />}
              {mode === "recording" ? "结束录音" : mode === "opening" ? "正在打开麦克风…" : mode === "transcribing" ? "正在转写…" : "录一句"}
            </button>
            <button className="coaching-primary" type="submit" disabled={mode !== "idle" || !attempt.trim()}>
              {mode === "checking" ? <>检查中… <LoaderCircle className="replay-spinner" size={16} aria-hidden="true" /></>
                : <>检查这次说法 <ArrowRight size={16} /></>}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">{exercise ? "Pip 会按转写后的文字检查这项用法。" : "录音会转成文字，复练检查用词、语法和原意。"}</p>
        </form>
        {error && <p role="alert" className="replay-error">{error}</p>}
        {result && <div className={`replay-result${exercise && !result.task_met ? " replay-result-retry" : ""}`} role="status">
          {(exercise ? result.task_met : result.natural) && <strong><CheckCircle2 size={17} /> {exercise ? "练到这一点了" : "这次说对了"}</strong>}
          <p>{result.explanation}</p>
          {!exercise && !result.natural && <p lang="en"><InteractiveEnglishText text={result.suggestion} /></p>}
        </div>}
        {reference && <details className="replay-reference"><summary>查看参考说法</summary>
          <p lang="en"><InteractiveEnglishText text={reference} /></p>
        </details>}
      </div>
    </div>
  );
}
