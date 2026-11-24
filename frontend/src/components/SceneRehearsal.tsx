import { ArrowRight, BookOpen, Clock3, Hand, MessageCircle, Pause, Play, Square, Volume2, type LucideIcon } from "lucide-react";
import { useId, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import counter from "../assets/prep/cafe-counter.webp";
import latte from "../assets/prep/latte.webp";
import oatMilk from "../assets/prep/oat-milk.webp";
import cardReader from "../assets/prep/card-reader.webp";
import pip from "../assets/pip-384.webp";
import { practiceCues } from "../data/practiceCues";
import { rehearsalScene } from "../data/rehearsalScenes";
import { usePracticePlayback } from "../hooks/usePracticePlayback";
import type { useSceneCues } from "../hooks/useSceneCues";
import type { CoachingExample, CustomScene } from "../lib/api";
import { replayHref, replayReference } from "../lib/practiceCorrections";
import { useRewardEquipped } from "../lib/rewards";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { CoachingExamples } from "./PersonalCoaching";
import { Wordmark } from "./Wordmark";
import { RehearsalAtmosphere } from "./RehearsalAtmosphere";
import { SceneCueEditor } from "./SceneCueEditor";
import "./SceneRehearsal.css";

const propsByKeyword: Record<string, { image: string; label: string; x: number; pipX: number; expression: RegExp }> = {
  "a latte": { image: latte, label: "拿铁", x: 23, pipX: 17, expression: /\blattes?\b/i },
  "oat milk": { image: oatMilk, label: "燕麦奶", x: 53, pipX: 43, expression: /\boat[ -]milk\b/i },
  "pay by card": { image: cardReader, label: "刷卡", x: 81, pipX: 71,
    expression: /\b(?:by|(?:credit|debit)|(?:pay(?:ing)?|paid|with|use)(?:\s+(?:by|with|a|my|the))*)\s+card\b/i },
};

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(notify: () => void) {
  const query = window.matchMedia?.(motionQuery);
  query?.addEventListener("change", notify);
  return () => query?.removeEventListener("change", notify);
}
const prefersStill = () => window.matchMedia?.(motionQuery).matches ?? false;

const words = (text: string) => text.toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)?/g)?.join(" ") ?? "";

function expressionMatcher(keyword: string) {
  const expression = words(keyword).replace(/^(?:a|an|the) /, "");
  return (text: string) => Boolean(expression && ` ${words(text)} `.includes(` ${expression} `));
}

function Recall({ example, matches }: { example: CoachingExample; matches: (text: string) => boolean }) {
  const [expanded, setExpanded] = useState(false);
  const referenceId = useId();
  const reference = replayReference(example);
  const related = example.corrections.filter(fix => matches(fix.original) || matches(fix.suggestion));
  const marked = related.some(fix => fix.marked || fix.self_marked);
  const explanation = related.find(fix => fix.note && fix.suggestion)?.note;
  return <div className="rehearsal-recall">
    <span>{marked ? "上次标记" : "上次纠错"}</span><q lang="en">{example.original}</q>
    <div className="rehearsal-recall-actions">
      {reference && reference !== example.original && <button type="button" aria-expanded={expanded} aria-controls={referenceId}
        onClick={() => setExpanded(value => !value)}>{expanded ? "收起参考说法" : "看参考说法"}</button>}
      <Link to={replayHref(example)}>重练原句</Link>
    </div>
    {reference && <div id={referenceId} hidden={!expanded} className="rehearsal-reference">
      <p lang="en"><InteractiveEnglishText text={reference} /></p>
      {explanation && <p>{explanation}</p>}
    </div>}
  </div>;
}

export function SceneRehearsal({ scenarioId, customScene, title, goal, icon: Icon, minutes, library, examples, practiceUrl, children, cueHeading }: {
  scenarioId: string; customScene?: CustomScene | null; title: string; goal: string; icon: LucideIcon; minutes?: number;
  library: ReturnType<typeof useSceneCues>; examples: CoachingExample[]; practiceUrl: string;
  children?: ReactNode; cueHeading: string;
}) {
  const [choice, setChoice] = useState({ id: "", takes: 0, direction: 0 });
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, prefersStill);
  const still = reduced || paused;
  const audio = usePracticePlayback(scenarioId);
  const theme = rehearsalScene(scenarioId, customScene);
  const isCafe = scenarioId === "cafe";
  const rainy = useRewardEquipped("cafe-rain", isCafe);
  const custom = scenarioId === "custom";
  const usesDefaultBackdrop = custom && theme === rehearsalScene("custom");
  const defaults = practiceCues(scenarioId);
  const cues = library.cues.map(cue => ({
    ...cue, prop: isCafe ? Object.values(propsByKeyword).find(prop => prop.expression.test(cue.keyword) || prop.expression.test(cue.sentence)) : undefined,
    matches: expressionMatcher(cue.keyword),
  }));
  const selectedIndex = Math.max(0, cues.findIndex(cue => cue.id === choice.id));
  const selected = cues[selectedIndex];
  const marks = cues.slice(0, 3).map((cue, index) => ({
    cue, index, x: [23, 53, 81][index],
    Icon: (!custom ? theme.icons[defaults.findIndex(([keyword]) => words(keyword) === words(cue.keyword))] : undefined)
      ?? (cue.kind === "pattern" ? MessageCircle : BookOpen),
  }));
  const pipX = isCafe ? selected?.prop?.pipX ?? 17 : (marks[selectedIndex]?.x ?? 23) - 6;
  const hasHotspots = isCafe ? cues.some(cue => cue.prop) : marks.length > 0;
  const matchesCue = (cue: typeof selected, text: string) => cue.prop ? cue.prop.expression.test(text) : cue.matches(text);
  const notes = new Map<number, CoachingExample>();
  const remaining = examples.filter(example => {
    if (example.scenario_id !== scenarioId) return true;
    const index = cues.findIndex(cue => example.corrections.some(fix =>
      matchesCue(cue, fix.original) || matchesCue(cue, fix.suggestion)));
    if (index < 0 || notes.has(index)) return true;
    notes.set(index, example);
    return false;
  });

  function select(index: number) {
    const cue = cues[index];
    setChoice(prev => ({ id: cue.id, takes: prev.takes + 1, direction: Math.sign(index - selectedIndex) }));
    audio.toggle(cue.id, cue.sentence || cue.keyword);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    if (still || event.pointerType !== "mouse") return;
    const stage = event.currentTarget;
    const box = stage.getBoundingClientRect();
    stage.style.setProperty("--pan-x", `${6 * ((event.clientX - box.left) / box.width - .5)}px`);
    stage.style.setProperty("--pan-y", `${4 * ((event.clientY - box.top) / box.height - .5)}px`);
  }

  return <div className="prep-page prep-rehearsal">
    <header className="rehearsal-site">
      <Wordmark />
      <Link className="rehearsal-crumb" to={custom ? "/custom" : "/scenes"}>{custom ? "自定义场景" : "场景练习"}</Link>
      {reduced ? <span className="rehearsal-motion">已减少动态</span> :
        <button type="button" className="rehearsal-motion" onClick={() => setPaused(value => !value)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "开启动效" : "暂停动效"}
        </button>}
    </header>
    <main id="spoken-main" tabIndex={-1} className="prep-shell">
      <div className="rehearsal-heading">
        <p className="coaching-kicker"><Icon size={16} /> 场景预习
          {!isCafe && minutes && <span><Clock3 size={14} /> 约 {minutes} 分钟</span>}</p>
        <h1>{title}</h1>
        <p className="prep-goal">{goal}</p>
      </div>
      {children}
      <div className="rehearsal-spread" data-still={still}>
        <figure className="rehearsal-figure">
          <div className="rehearsal-stage" data-weather={rainy ? "rain" : undefined} onPointerMove={pan} onPointerLeave={({ currentTarget }) => {
            currentTarget.style.removeProperty("--pan-x"); currentTarget.style.removeProperty("--pan-y");
          }}>
            {isCafe ? <img className="rehearsal-backdrop" src={counter} alt="" draggable={false} />
              : <div className="rehearsal-backdrop rehearsal-atlas" aria-hidden="true" style={{
                backgroundImage: `url(${theme.atlas})`,
                backgroundPosition: `${(theme.cell % 3) * 50}% ${Math.floor(theme.cell / 3) * 50}%`,
              }} />}
            <div className="rehearsal-pip" data-direction={choice.direction} style={{ left: `${pipX}%` }} aria-hidden="true">
              <div key={choice.takes} className={choice.takes ? "rehearsal-hop" : undefined}><img src={pip} alt="" draggable={false} /></div>
            </div>
            {isCafe ? Object.entries(propsByKeyword).map(([keyword, prop]) => {
              const index = selected?.prop === prop ? selectedIndex : cues.findIndex(cue => cue.prop === prop);
              return index >= 0 && <button key={keyword} type="button"
                className="rehearsal-prop" data-object={keyword} aria-label={`听${prop.label}的例句`}
                aria-pressed={selectedIndex === index} style={{ left: `${prop.x}%` }} onClick={() => select(index)}>
              <span key={selectedIndex === index ? choice.takes : 0}
                className={`rehearsal-object${selectedIndex === index && choice.takes ? " rehearsal-lift" : ""}`}>
                <img src={prop.image} alt="" draggable={false} />
              </span>
            </button>;
            }) : marks.map(({ cue, index, x, Icon: CueIcon }) => <button key={cue.id} type="button" className="rehearsal-marker"
              aria-label={`听${cue.meaning || cue.keyword}的例句`} aria-pressed={selectedIndex === index}
              style={{ left: `${x}%` }} onClick={() => select(index)}>
              <span key={selectedIndex === index ? choice.takes : 0}
                className={selectedIndex === index && choice.takes ? "rehearsal-lift" : undefined}>
                <CueIcon size={24} aria-hidden="true" />
              </span>
            </button>)}
            <RehearsalAtmosphere still={still} effect={rainy ? "cafe-rain" : isCafe ? "cafe" : theme.air} />
          </div>
          <figcaption className="rehearsal-caption">
            {rainy && <span>雨天咖啡馆</span>}
            {usesDefaultBackdrop && <span>通用背景</span>}
            {hasHotspots && <span className="rehearsal-instruction" data-chosen={choice.takes > 0}><Hand size={16} />
              {isCafe ? "点柜台上的物品，听对应的例句。" : "点场景里的图标，听对应的例句。"}</span>}
            {choice.takes > 0 && selected?.id === choice.id && <span className="rehearsal-mobile-line" lang="en"><Volume2 size={16} />{selected.sentence}</span>}
          </figcaption>
        </figure>
        <section className="rehearsal-menu" aria-labelledby="rehearsal-menu-title">
          <SceneCueEditor library={library} heading={<h2 id="rehearsal-menu-title">{cueHeading}</h2>} />
          {library.ready && !cues.length && <p className="text-sm text-muted">点「编辑预习」添加想练的表达。</p>}
          <ol>{cues.map((cue, index) => {
            const { id, keyword, meaning, sentence } = cue;
            const active = selectedIndex === index;
            const phase = audio.activeKey === id ? audio.phase : null;
            const note = notes.get(index);
            return <li key={id} data-selected={active} data-phase={phase}>
              <div className="rehearsal-menu-line">
                {sentence === keyword ? <div className="rehearsal-order">
                  <p lang="en"><InteractiveEnglishText text={keyword} /></p>{meaning && <span>{meaning}</span>}
                </div> : <>
                  <button type="button" className="rehearsal-order" aria-pressed={active} onClick={() => select(index)}>
                    <strong lang="en">{keyword}</strong>{meaning && <span>{meaning}</span>}
                  </button>
                  <p lang="en"><InteractiveEnglishText text={sentence} /></p>
                </>}
                <button type="button" className="rehearsal-speaker" onClick={() => select(index)}
                  aria-label={`${phase ? "停止朗读" : "朗读"} ${keyword}`}>
                  {phase === "speaking" && !still ? <span aria-hidden="true" className="rehearsal-meter"><i /><i /><i /></span> :
                    phase ? <Square size={17} /> : <Volume2 size={20} />}
                </button>
              </div>
              {note && (active ? <Recall key={replayHref(note)} example={note} matches={text => matchesCue(cue, text)} /> :
                <small className="rehearsal-history-hint">有你的练习记录</small>)}
            </li>;
          })}</ol>
          {remaining.length > 0 && <aside className="rehearsal-history" aria-labelledby="rehearsal-personal">
            <h3 id="rehearsal-personal">你的易错表达</h3>
            <CoachingExamples examples={remaining.slice(0, 2)} showReference />
            {remaining.length > 2 && <details><summary>更多原句（{remaining.length - 2}）</summary>
              <CoachingExamples examples={remaining.slice(2)} showReference /></details>}
          </aside>}
          <div className="rehearsal-start"><Link to={practiceUrl} className="coaching-primary">{isCafe ? "开始对话" : "开始场景练习"} <ArrowRight size={18} /></Link></div>
        </section>
      </div>
    </main>
  </div>;
}
