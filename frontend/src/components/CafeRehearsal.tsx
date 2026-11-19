import { ArrowRight, Coffee, Hand, Pause, Play, Square, Volume2 } from "lucide-react";
import { useId, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import counter from "../assets/prep/cafe-counter.webp";
import latte from "../assets/prep/latte.webp";
import oatMilk from "../assets/prep/oat-milk.webp";
import cardReader from "../assets/prep/card-reader.webp";
import pip from "../assets/pip-384.webp";
import { usePracticePlayback } from "../hooks/usePracticePlayback";
import type { useSceneCues } from "../hooks/useSceneCues";
import type { CoachingExample } from "../lib/api";
import { replayHref, replayReference } from "../lib/practiceCorrections";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { CoachingExamples } from "./PersonalCoaching";
import { Wordmark } from "./Wordmark";
import { CafeAtmosphere } from "./CafeAtmosphere";
import { SceneCueEditor } from "./SceneCueEditor";
import "./CafeRehearsal.css";

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

// Attach a note to the expression that was corrected, even when the original omitted a word.
function exampleUsesProp(example: CoachingExample, expression: RegExp) {
  return example.scenario_id === "cafe" && example.corrections.some(fix =>
    expression.test(fix.original) || expression.test(fix.suggestion));
}

function Recall({ example, expression }: { example: CoachingExample; expression: RegExp }) {
  const [expanded, setExpanded] = useState(false);
  const referenceId = useId();
  const reference = replayReference(example);
  const marked = example.corrections.some(fix => fix.marked || fix.self_marked);
  const explanation = example.corrections.find(fix =>
    fix.note && fix.suggestion && (expression.test(fix.original) || expression.test(fix.suggestion)))?.note;
  return <div className="cafe-recall">
    <span>{marked ? "上次标记" : "上次纠错"}</span><q lang="en">{example.original}</q>
    <div className="cafe-recall-actions">
      {reference && reference !== example.original && <button type="button" aria-expanded={expanded} aria-controls={referenceId}
        onClick={() => setExpanded(value => !value)}>{expanded ? "收起参考说法" : "看参考说法"}</button>}
      <Link to={replayHref(example)}>重练原句</Link>
    </div>
    {reference && <div id={referenceId} hidden={!expanded} className="cafe-reference">
      <p lang="en"><InteractiveEnglishText text={reference} /></p>
      {explanation && <p>{explanation}</p>}
    </div>}
  </div>;
}

export function CafeRehearsal({ title, library, examples, practiceUrl, children }: {
  title: string; library: ReturnType<typeof useSceneCues>; examples: CoachingExample[]; practiceUrl: string; children?: ReactNode;
}) {
  const [choice, setChoice] = useState({ id: "", takes: 0, direction: 0 });
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, prefersStill);
  const still = reduced || paused;
  const audio = usePracticePlayback("cafe");
  const cues = library.cues.map(cue => ({
    ...cue, prop: Object.values(propsByKeyword).find(prop => prop.expression.test(cue.keyword) || prop.expression.test(cue.sentence)),
  }));
  const selectedIndex = Math.max(0, cues.findIndex(cue => cue.id === choice.id));
  const selected = cues[selectedIndex];
  const notes = new Map<number, CoachingExample>();
  const remaining = examples.filter(example => {
    const index = cues.findIndex(({prop}) => prop && exampleUsesProp(example, prop.expression));
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

  return <div className="prep-page prep-cafe">
    <header className="cafe-site">
      <Wordmark />
      <Link className="cafe-crumb" to="/scenes">场景练习</Link>
      {reduced ? <span className="cafe-motion">已减少动态</span> :
        <button type="button" className="cafe-motion" onClick={() => setPaused(value => !value)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}{paused ? "开启动效" : "暂停动效"}
        </button>}
    </header>
    <main id="spoken-main" tabIndex={-1} className="prep-shell">
      <div className="cafe-heading">
        <p className="coaching-kicker"><Coffee size={16} /> 场景预习</p>
        <h1>{title}</h1>
        <p className="prep-goal">点一杯拿铁，试着换燕麦奶，最后问能否刷卡。</p>
      </div>
      {children}
      <div className="cafe-spread" data-still={still}>
        <figure className="cafe-figure">
          <div className="cafe-counter" onPointerMove={pan} onPointerLeave={({ currentTarget }) => {
            currentTarget.style.removeProperty("--pan-x"); currentTarget.style.removeProperty("--pan-y");
          }}>
            <img className="cafe-backdrop" src={counter} alt="" draggable={false} />
            <div className="cafe-pip" data-direction={choice.direction} style={{ left: `${selected?.prop?.pipX ?? 17}%` }} aria-hidden="true">
              <div key={choice.takes} className={choice.takes ? "cafe-hop" : undefined}><img src={pip} alt="" draggable={false} /></div>
            </div>
            {Object.entries(propsByKeyword).map(([keyword, prop]) => {
              const index = selected?.prop === prop ? selectedIndex : cues.findIndex(cue => cue.prop === prop);
              return index >= 0 && <button key={keyword} type="button"
                className="cafe-prop" data-object={keyword} aria-label={`听${prop.label}的例句`}
                aria-pressed={selectedIndex === index} style={{ left: `${prop.x}%` }} onClick={() => select(index)}>
              <span key={selectedIndex === index ? choice.takes : 0}
                className={`cafe-object${selectedIndex === index && choice.takes ? " cafe-lift" : ""}`}>
                <img src={prop.image} alt="" draggable={false} />
              </span>
            </button>;
            })}
            <CafeAtmosphere still={still} />
          </div>
          <figcaption className="cafe-caption">
            {cues.some(cue => cue.prop) && <span className="cafe-instruction" data-chosen={choice.takes > 0}><Hand size={16} /> 点柜台上的物品，听对应的例句。</span>}
            {choice.takes > 0 && selected?.id === choice.id && <span className="cafe-mobile-line" lang="en"><Volume2 size={16} />{selected.sentence}</span>}
          </figcaption>
        </figure>
        <section className="cafe-menu" aria-labelledby="cafe-menu-title">
          <SceneCueEditor library={library} heading={<h2 id="cafe-menu-title">预习菜单</h2>} />
          {library.ready && !cues.length && <p className="text-sm text-muted">菜单还是空的。点「编辑预习」可添加想练的表达。</p>}
          <ol>{cues.map(({ id, keyword, meaning, sentence, prop }, index) => {
            const active = selectedIndex === index;
            const phase = audio.activeKey === id ? audio.phase : null;
            const note = notes.get(index);
            return <li key={id} data-selected={active} data-phase={phase}>
              <div className="cafe-menu-line">
                {sentence === keyword ? <div className="cafe-order">
                  <strong lang="en"><InteractiveEnglishText text={keyword} /></strong>{meaning && <span>{meaning}</span>}
                </div> : <>
                  <button type="button" className="cafe-order" aria-pressed={active} onClick={() => select(index)}>
                    <strong lang="en">{keyword}</strong>{meaning && <span>{meaning}</span>}
                  </button>
                  <p lang="en"><InteractiveEnglishText text={sentence} /></p>
                </>}
                <button type="button" className="cafe-speaker" onClick={() => select(index)}
                  aria-label={`${phase ? "停止朗读" : "朗读"} ${keyword}`}>
                  {phase === "speaking" && !still ? <span aria-hidden="true" className="cafe-meter"><i /><i /><i /></span> :
                    phase ? <Square size={17} /> : <Volume2 size={20} />}
                </button>
              </div>
              {note && prop && (active ? <Recall key={replayHref(note)} example={note} expression={prop.expression} /> :
                <small className="cafe-history-hint">有你的练习记录</small>)}
            </li>;
          })}</ol>
          {remaining.length > 0 && <aside className="cafe-history" aria-labelledby="cafe-personal">
            <h3 id="cafe-personal">你的易错表达</h3>
            <CoachingExamples examples={remaining.slice(0, 2)} showReference />
            {remaining.length > 2 && <details><summary>更多原句（{remaining.length - 2}）</summary>
              <CoachingExamples examples={remaining.slice(2)} showReference /></details>}
          </aside>}
          <div className="cafe-start"><Link to={practiceUrl} className="coaching-primary">开始对话 <ArrowRight size={18} /></Link></div>
        </section>
      </div>
    </main>
  </div>;
}
