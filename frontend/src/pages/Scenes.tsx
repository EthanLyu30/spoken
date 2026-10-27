import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { chapters, getScenario, scenarios, type Scenario } from "../data/scenarios";
import { JourneyPath } from "../components/JourneyPath";
import { SceneTabs } from "../components/SceneTabs";
import { BottomNav } from "../components/BottomNav";

const groupedIds = new Set(chapters.flatMap((chapter) => chapter.ids));
const otherScenes = scenarios.filter((scene) => !groupedIds.has(scene.id));

export default function Scenes() {
  const [active, setActive] = useState(0);
  const chapter = chapters[active];
  const selected = chapter.ids.map(getScenario).filter((s): s is Scenario => !!s);
  return <div className="min-h-screen pb-24"><main className="mx-auto scene-page">
    <div className="ui-page-head"><div><p className="eyebrow">SCENE PRACTICE</p><h1>场景练习</h1><p>从熟悉的生活开始，一次对话，走近真实表达。</p></div><SceneTabs /></div>
    <div className="chapter-bar">{chapters.map((item, i) => <button type="button" key={item.title} aria-pressed={active === i} className={active === i ? "active" : ""} onClick={() => setActive(i)}>{item.titleZh}</button>)}<span>{chapter.title} · {selected.length} 关</span></div>
    <JourneyPath scenarios={selected} key={chapter.title} />
    {otherScenes.length > 0 && <section className="ui-section additional-scenes"><h2>更多场景</h2><div>{otherScenes.map((s) => <Link to={`/practice/${s.id}`} key={s.id}><span><strong>{s.titleZh}</strong><small>{s.title}</small></span><ArrowRight /></Link>)}</div></section>}
  </main><BottomNav /></div>;
}
