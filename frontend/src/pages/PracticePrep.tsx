import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, MessageCircle, Square, Target, Volume2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import practiceArt from "../assets/pip-speaking-practice.webp";
import { SceneRehearsal } from "../components/SceneRehearsal";
import { InteractiveEnglishText } from "../components/dictionary/InteractiveEnglishText";
import { SentenceReplay } from "../components/SentenceReplay";
import { SceneCueEditor } from "../components/SceneCueEditor";
import { getScenario } from "../data/scenarios";
import { useCoachingSnapshot } from "../hooks/useCoachingSnapshot";
import { usePracticePlayback } from "../hooks/usePracticePlayback";
import { useSceneCues } from "../hooks/useSceneCues";
import { getSession, type CustomScene, type PracticeExercise } from "../lib/api";
import { getAuthGeneration } from "../lib/authToken";
import { scenarioIcons } from "../lib/icons";
import { correctionDrills, isCorrectionCategory, sentenceForReplay, type ReplaySentence } from "../lib/practiceCorrections";
import { useCustomScene } from "../store/custom";
import { recordCreationQuery } from "../lib/practiceRecordStatus";
import "../coaching.css";

function SavedSentence({ review, createdAt }: { review: string; createdAt?: string }) {
  const [data, setData] = useState<{ example: ReplaySentence; scenarioId: string; title?: string; custom?: CustomScene } | null>();
  const generation = getAuthGeneration();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.focus({ preventScroll: true });
    section.current?.scrollIntoView?.({ block: "start" });
  }, []);
  useEffect(() => {
    const match = /^(\d{1,15}):(\d{1,3})$/.exec(review);
    if (!match) return;
    const controller = new AbortController();
    getSession(Number(match[1]), controller.signal, createdAt).then(({ messages, corrections, scenario_id, custom }) => {
      if (!controller.signal.aborted && generation === getAuthGeneration()) {
        const sentence = sentenceForReplay(messages, (corrections ?? []).filter(fix => !fix.self_marked), Number(match[2]));
        const scenario = getScenario(scenario_id);
        setData(sentence?.corrections.length ? {
          example: sentence, scenarioId: scenario?.id ?? "custom",
          title: scenario?.titleZh ?? (custom?.title_zh || custom?.title), custom: custom ?? undefined,
        } : null);
      }
    }).catch(() => {
      if (!controller.signal.aborted && generation === getAuthGeneration()) setData(null);
    });
    return () => controller.abort();
  }, [generation, review, createdAt]);
  const invalid = !/^\d{1,15}:\d{1,3}$/.test(review);
  return <div className="prep-page">
    <main id="spoken-main" tabIndex={-1} className="prep-shell">
      <Link to="/progress" className="prep-back"><ArrowLeft size={17} /> 返回学习进度</Link>
      <section ref={section} tabIndex={-1} className="prep-focus" aria-label="重练原句">
        <div className="coaching-heading"><h2>重练原句</h2><Target size={22} aria-hidden="true" /></div>
        {invalid || data === null ? <p role="status">这条原句暂时无法读取。</p>
          : data === undefined ? <p role="status">正在找回那句话…</p> : <>
            <p>{data.title ? `原场景 · ${data.title}` : "根据已保存的对话检查这次说法。"}</p>
            <SentenceReplay example={data.example} scenarioId={data.scenarioId} custom={data.custom} />
            {data.scenarioId !== "custom" && <Link to={`/prepare/${data.scenarioId}`} className="prep-back mt-3">
              继续预习 {data.title}<ArrowRight size={16} />
            </Link>}
          </>}
      </section>
    </main>
  </div>;
}

function SavedLesson({ sessionId, createdAt }: { sessionId: string; createdAt?: string }) {
  const [scene, setScene] = useState<CustomScene | null>();
  const generation = getAuthGeneration();
  const valid = /^\d{1,15}$/.test(sessionId) && Number(sessionId) > 0;
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    getSession(Number(sessionId), controller.signal, createdAt).then(detail => {
      if (current()) setScene(detail.scenario_id === "custom" && detail.custom?.practice_exercises?.length === 2 ? detail.custom : null);
    }).catch(() => {
      if (current()) setScene(null);
    });
    return () => controller.abort();
  }, [generation, sessionId, valid, createdAt]);
  if (scene?.practice_exercises) return <GuidedPrep scene={scene} exercises={scene.practice_exercises} />;
  return <div className="prep-page"><main id="spoken-main" tabIndex={-1} className="prep-shell">
    <Link className="prep-back" to={valid ? `/session/${sessionId}${recordCreationQuery(createdAt)}` : "/progress"}><ArrowLeft size={17} /> 返回练习记录</Link>
    <p role="status">{!valid || scene === null ? "这次训练题暂时无法读取。" : "正在加载这次训练的题目…"}</p>
  </main></div>;
}

export default function PracticePrep() {
  const { scenarioId = "" } = useParams();
  const [search] = useSearchParams();
  const focusId = search.get("focus");
  const review = search.get("review");
  const lesson = search.get("lesson");
  const createdAt = search.get("created_at") ?? undefined;
  const customScene = useCustomScene((state) => state.scene);
  if (review !== null) return <SavedSentence key={`${getAuthGeneration()}:${review}:${createdAt ?? ""}`} review={review} createdAt={createdAt} />;
  if (scenarioId === "custom" && lesson !== null)
    return <SavedLesson key={`${getAuthGeneration()}:${lesson}:${createdAt ?? ""}`} sessionId={lesson} createdAt={createdAt} />;
  const scenario = getScenario(scenarioId);
  const custom = scenarioId === "custom" ? customScene : null;
  if (!scenario && !custom) return <Navigate to={scenarioId === "custom" ? "/custom" : "/scenes"} replace />;
  if (custom?.practice_exercises?.length) {
    return <GuidedPrep key={JSON.stringify(custom.practice_exercises)} scene={custom} exercises={custom.practice_exercises} />;
  }
  return <Prep key={custom ? JSON.stringify(custom) : scenarioId} scenarioId={scenarioId} focusId={focusId} />;
}

function GuidedPrep({ scene, exercises }: { scene: CustomScene; exercises: PracticeExercise[] }) {
  const setCustomScene = useCustomScene(state => state.setScene);
  const library = useSceneCues("custom", scene);
  const main = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shouldFocus = useRef(false);
  const turnId = useId();
  const [{ step, direction }, setNavigation] = useState({ step: 0, direction: "forward" });
  const [passed, setPassed] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [showCues, setShowCues] = useState(false);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    main.current?.scrollIntoView?.({ block: "start" });
  }, []);
  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "nearest" });
  }, [step]);

  function goTo(index: number) {
    if (busy || index === step) return;
    shouldFocus.current = true;
    setNavigation({ step: index, direction: index < step ? "back" : "forward" });
  }

  return <div className="prep-page prep-page-guided">
    <main ref={main} id="spoken-main" tabIndex={-1} className="prep-shell guided-prep">
      <Link to="/progress" className="prep-back"><ArrowLeft size={17} /> 返回学习进度</Link>
      <header className="guided-header prep-masthead">
        <div className="prep-hero-copy">
          <p className="coaching-kicker">专项口语练习</p>
          <h1>{scene.title_zh || scene.title}</h1>
          {scene.title_zh && scene.title !== scene.title_zh && <p className="guided-english" lang="en">{scene.title}</p>}
          <p className="guided-progress" aria-live="polite">已达标 <strong>{passed.length} / {exercises.length}</strong></p>
        </div>
        <div className="prep-masthead-art"><img src={practiceArt} alt="" /></div>
      </header>
      <div className="guided-workspace" data-direction={direction}>
        <div className="guided-toolbar">
          <nav className="guided-steps" aria-label="选择练习题" style={{ "--step": step, "--step-width": `${100 / exercises.length}%` } as CSSProperties}>
            {exercises.map((exercise, index) => <button key={exercise.partner_line} type="button"
              aria-current={step === index ? "step" : undefined} aria-controls={`${turnId}-${index}`} disabled={busy}
              onClick={() => goTo(index)}>
              第 {index + 1} 句{passed.includes(index) && <><Check size={14} aria-hidden="true" /><span className="sr-only">，已达标</span></>}
            </button>)}
          </nav>
          <button type="button" className="guided-preview-toggle" aria-expanded={showCues}
            aria-controls={`${turnId}-cues`} onClick={() => setShowCues(!showCues)}>
            <BookOpen size={16} aria-hidden="true" /> 先看可用句型 <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
        <div id={`${turnId}-cues`} hidden={!showCues}>
          {showCues && <PrepPhrases library={library} scenarioId="custom" />}
        </div>
        {exercises.map((exercise, index) => {
          const current = step === index;
          const id = `${turnId}-${index}`;
          return <section key={exercise.partner_line} id={id} hidden={!current} className="guided-turn" aria-label={index === 0 ? "先试一句" : "接着再说一句"}>
            <SentenceReplay exercise={exercise} questionRef={current ? heading : undefined} scenarioId="custom" custom={scene} hidden={!current} onBusyChange={setBusy}
              onPass={() => setPassed((previous) => previous.includes(index) ? previous : [...previous, index])} />
          </section>;
        })}
        <div className="guided-navigation">
          {step > 0 && <button className="coaching-secondary" type="button" disabled={busy} onClick={() => goTo(step - 1)}>
            <ArrowLeft size={17} /> 上一句
          </button>}
          {step < exercises.length - 1 && <button className="coaching-secondary guided-next" type="button" disabled={busy} onClick={() => goTo(step + 1)}>
            下一句 <ArrowRight size={17} />
          </button>}
        </div>
      </div>
      <div className="guided-actions">
        <Link className="coaching-secondary" to="/practice/custom" onClick={() => setCustomScene(scene)}>
          在这个场景自由对话 <ArrowRight size={17} />
        </Link>
        <Link className="coaching-example-link" to="/feedback?from=coaching" state={{
          coaching: { title: scene.title_zh || scene.title,
            tasks: exercises.map(({ task, target }) => target ? `${task} ${target.instruction}` : task) },
        }}>这组练习没有练到我的错误</Link>
      </div>
    </main>
  </div>;
}

function PrepPhrases({ library, scenarioId }: {
  library: ReturnType<typeof useSceneCues>;
  scenarioId: string;
}) {
  const audio = usePracticePlayback(scenarioId);
  return <section className="prep-phrases">
    <SceneCueEditor library={library} />
    {library.ready && !library.cues.length && <p className="text-sm text-muted">这里还没有表达。点「编辑预习」可以添加。</p>}
    <ul>{library.cues.map(({id, keyword, meaning, sentence}, index) => {
      const active = audio.activeKey === id;
      return <li key={id} data-playback={active ? audio.phase : undefined} style={{ "--phrase-delay": `${Math.min(index, 5) * 55}ms` } as CSSProperties}>
        <p className="prep-keyword" lang="en">{sentence === keyword ? <InteractiveEnglishText text={keyword} /> : keyword}</p>
        {meaning && <p className="prep-meaning">{meaning}</p>}
        {sentence !== keyword && <p className="prep-example" lang="en"><InteractiveEnglishText text={sentence} /></p>}
        <button type="button" className="prep-listen" aria-label={`${active ? "停止朗读" : "朗读"} ${keyword}`}
          onClick={() => audio.toggle(id, sentence || keyword)}>{active ? <Square size={15} /> : <Volume2 size={19} />}</button>
      </li>;
    })}</ul>
  </section>;
}

function Prep({ scenarioId, focusId }: { scenarioId: string; focusId: string | null }) {
  const scenario = getScenario(scenarioId);
  const custom = useCustomScene((state) => scenarioId === "custom" ? state.scene : null);
  const { snapshot } = useCoachingSnapshot(scenarioId, custom);
  const focus = isCorrectionCategory(focusId) ? correctionDrills[focusId] : null;
  const library = useSceneCues(scenarioId, custom);
  const SceneIcon = scenario ? scenarioIcons[scenario.icon] : MessageCircle;

  const articleExample = focusId === "articles"
    ? library.cues.map(cue => cue.sentence).find(sentence => /\b(?:a|an|the)\b/i.test(sentence))
    : undefined;
  const drillPrompt = articleExample?.replace(/\b(?:a|an|the)\b/i, "___");
  const title = scenario?.titleZh ?? (custom?.title_zh || custom?.title || "自定义场景");
  const goal = scenarioId === "cafe" ? "点一杯拿铁，试着换燕麦奶，最后问能否刷卡。" : scenario?.subtitle ?? custom?.goal ?? "";
  const practiceUrl = `/practice/${scenarioId}${focus ? `?focus=${focusId}` : ""}`;
  const cueHeading = scenarioId === "cafe" ? "预习菜单" : custom && !custom.practice_cues?.length ? "开口句型" : "关键词与句型";

  const focusSection = focus && (
    <section className="prep-focus" aria-label={`专项复练 · ${focus.label}`}>
      <div className="coaching-heading"><h2>专项复练 · {focus.label}</h2><Target size={22} aria-hidden="true" /></div>
      <p>{focus.task}</p>
      <p className="font-semibold">{drillPrompt ? "补全这句里的冠词，再试着说一遍。" : focus.prompt}</p>
      {drillPrompt && <p className="prep-cloze" lang="en">{drillPrompt}</p>}
      <details className="replay-reference"><summary>查看参考说法</summary>
        <p lang="en"><InteractiveEnglishText text={articleExample ?? focus.answer} /></p>
      </details>
    </section>
  );
  return <SceneRehearsal scenarioId={scenarioId} customScene={custom} title={title} goal={goal} icon={SceneIcon} minutes={scenario?.minutes}
    cueHeading={cueHeading} library={library} examples={snapshot?.examples ?? []} practiceUrl={practiceUrl}>
    {focusSection}
  </SceneRehearsal>;
}
