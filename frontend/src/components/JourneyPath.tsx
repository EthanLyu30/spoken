import { Link } from "react-router-dom";
import { Flag } from "lucide-react";
import { type Scenario, difficultyLabel } from "../data/scenarios";
import { scenarioIcons } from "../lib/icons";
import { xpReward } from "../data/progress";

/** All labels and links remain live catalogue data; illustration is decorative. */
export function JourneyPath({ scenarios }: { scenarios: Scenario[] }) {
  return <div className="journey-map"><ol>{scenarios.map((s, i) => {
    const Icon = scenarioIcons[s.icon];
    return <li key={s.id}><Link to={`/practice/${s.id}`} className={`journey-stop stop-${i + 1}`}><span className="stop-icon"><Icon /><b>{i + 1}</b></span><span className="stop-label"><strong>{s.titleZh}</strong><span>{s.title}</span><small>{difficultyLabel(s.difficulty)} · {s.minutes} 分钟 · +{xpReward(s.difficulty, s.minutes)} XP</small></span></Link></li>;
  })}</ol><div className="map-finish"><Flag /><span>通关</span></div></div>;
}
