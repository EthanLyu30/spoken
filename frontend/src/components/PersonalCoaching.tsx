import { ArrowRight, BookOpen, RotateCcw, Sparkles, Target } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCoachingSnapshot } from "../hooks/useCoachingSnapshot";
import { ApiError, postCoachingPlan, type CoachingExample, type CoachingPlan, type CoachingSnapshot } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { coachingPatternLabel, replayHref, replayReference } from "../lib/practiceCorrections";
import { useCustomScene } from "../store/custom";
import { getScenario } from "../data/scenarios";
import { progressGeneration } from "../lib/progressCache";
import { Buddy } from "./Buddy";
import "../coaching.css";

let lastPlan: CoachingPlan | null = null;
subscribeAuthGeneration(() => { lastPlan = null; });

export function CoachingExamples({ examples, repeatLabel = "重练", showReference = false }: {
  examples: CoachingExample[];
  repeatLabel?: string;
  showReference?: boolean;
}) {
  return <ul className="coaching-examples">
    {examples.map((example) => {
      const line = (showReference && replayReference(example)) || example.original;
      const fix = example.corrections.find((item) => item.suggestion && item.suggestion.length <= 160);
      return (
        <li key={`${example.session_id}:${example.turn_index}`}>
          <div>
            <p className="coaching-example-source">{getScenario(example.scenario_id)?.titleZh ?? "自定义练习"}</p>
            <p className="coaching-example-line" lang="en">{line}</p>
            {fix && <p className="coaching-phrase-pair" lang="en"><del>{fix.original}</del><ArrowRight size={12} /><strong>{fix.suggestion}</strong></p>}
          </div>
          <Link className="coaching-example-link" to={replayHref(example)}>
            <RotateCcw size={15} aria-hidden="true" /> {repeatLabel}
          </Link>
        </li>
      );
    })}
  </ul>;
}

export function PersonalCoaching({ fallback }: { fallback?: ReactNode }) {
  const { snapshot, error, retry } = useCoachingSnapshot();
  if (!snapshot?.examples.length) return <>
    {fallback}
    {error && <p className="learning-notice">暂时无法读取个人复练。 <button className="underline" type="button" onClick={retry}>重试</button></p>}
  </>;
  return <CoachingForRevision key={`${getAuthGeneration()}:${snapshot.revision}`} snapshot={snapshot} refresh={retry} />;
}

function CoachingForRevision({ snapshot, refresh }: { snapshot: CoachingSnapshot; refresh: () => void }) {
  const [plan, setPlan] = useState(() => lastPlan?.revision === snapshot.revision ? lastPlan : null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState("");
  const active = useRef<AbortController | null>(null);
  const lesson = useRef<HTMLElement>(null);
  const generation = useRef(getAuthGeneration()).current;
  const setScene = useCustomScene((state) => state.setScene);

  useEffect(() => {
    const abort = () => active.current?.abort();
    const unsubscribe = subscribeAuthGeneration(abort);
    return () => { unsubscribe(); abort(); };
  }, []);
  useEffect(() => { if (plan) lesson.current?.focus(); }, [plan]);

  async function generate() {
    if (active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    const progress = progressGeneration();
    const current = () => active.current === controller && !controller.signal.aborted
      && generation === getAuthGeneration() && progress === progressGeneration();
    active.current = controller;
    setPlanning(true);
    setPlanError("");
    try {
      const result = await postCoachingPlan(snapshot.revision, controller.signal);
      if (!current()) return;
      if (result.revision !== snapshot.revision) { refresh(); return; }
      lastPlan = result;
      setPlan(result);
    } catch (error) {
      if (!current()) return;
      if (error instanceof ApiError && error.status === 409) refresh();
      else if (error instanceof ApiError && error.status === 422) {
        setPlanError("Pip 暂时无法从这些错句确认可以单独练的用法。可以先重说原句。");
      } else if ((error instanceof ApiError && error.status === 504) || (error instanceof Error && error.name === "TimeoutError")) {
        setPlanError("训练计划生成超时，请重试。现在也可以先重练原句。");
      } else setPlanError("暂时没能生成计划，原句仍然可以重练。");
    } finally {
      if (current()) setPlanning(false);
      if (active.current === controller) active.current = null;
    }
  }

  const examples = snapshot.examples.filter((example) => !plan?.evidence.some((source) =>
    source.session_id === example.session_id && source.turn_index === example.turn_index)).slice(0, 3);
  const patterns = snapshot.patterns.slice(0, 3);
  const citedSessions = new Set(plan?.evidence.map((source) => source.session_id)).size;
  return (
    <section className="coaching-panel" aria-label="个人复练">
      <header className="coaching-panel-top">
        <div>
          <p className="coaching-kicker"><Target size={16} /> 个人复练</p>
          <h2>下次开口，先练这几句</h2>
        </div>
        <Buddy size={96} />
      </header>
      {plan && (
        <section ref={lesson} tabIndex={-1} className="coaching-plan" aria-label="Pip 的训练计划">
          <div className="coaching-heading"><h3>Pip 的训练计划</h3><Sparkles size={18} aria-hidden="true" /></div>
          <p className="coaching-example-source">来自 {citedSessions} 次练习 · {coachingPatternLabel(plan.focus)}</p>
          <p className="coaching-plan-summary">{plan.summary}</p>
          <div className="coaching-plan-practice">
            <div>
              <h4>先重说自己的句子</h4>
              <CoachingExamples examples={plan.evidence} repeatLabel="重说这句" />
            </div>
            <div className="coaching-plan-scene">
              <h4>换个情境再说</h4>
              <p className="coaching-plan-title">{plan.scene.title_zh || plan.scene.title}</p>
              <p>{plan.scene.practice_exercises[0]?.task}</p>
              <Link to="/prepare/custom" className="coaching-primary" onClick={() => setScene(plan.scene)}>
                开始专项练习 <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </section>
      )}
      <div className="coaching-panel-grid">
        {examples.length > 0 && <section className="coaching-queue" aria-label="值得重说的原句">
          <h3><BookOpen size={17} /> 值得重说的原句</h3>
          <CoachingExamples examples={examples} repeatLabel="重练原句" />
        </section>}
        <section className="coaching-insight" aria-label="易错点和训练计划">
          <h3>最近的易错点</h3>
          {patterns.length ? <ul className="coaching-patterns">
            {patterns.map((pattern) => <li key={`${pattern.kind}:${pattern.category}`}>
              <strong>{coachingPatternLabel(pattern)}</strong>
              <span>{pattern.sessions >= 2 ? "反复出现 · " : "单次练习发现 · "}{pattern.sessions} 次练习 · {pattern.occurrences} 处</span>
            </li>)}
          </ul> : <p>先重说一条收藏的原句。完成带纠错的练习后，Pip 可以帮你找规律。</p>}
          {patterns.length > 0 && !plan && <button type="button" className="coaching-primary" onClick={() => void generate()} disabled={planning}>
            <Sparkles size={16} /> {planning ? "正在分析你的错句…" : "让 Pip 排训练计划"}
          </button>}
          {planning && <p className="sr-only" role="status">正在生成个人训练计划</p>}
          {planError && <p role="alert" className="replay-error">{planError}</p>}
        </section>
      </div>
    </section>
  );
}
