import { type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, Star } from "lucide-react";
import { type Scenario } from "../data/scenarios";
import { scenarioIcons } from "../lib/icons";
import { themeFor } from "../lib/theme";
import { xpReward } from "../data/progress";
import { cn } from "../lib/utils";

interface ScenarioCardProps {
  scenario: Scenario;
  /** 1-based stop number on the journey path. */
  stop: number;
  className?: string;
  style?: CSSProperties;
}

export function ScenarioCard({ scenario, stop, className, style }: ScenarioCardProps) {
  const Icon = scenarioIcons[scenario.icon];
  const t = themeFor(scenario.id);
  const xp = xpReward(scenario.difficulty, scenario.minutes);

  return (
    <Link
      to={`/practice/${scenario.id}`}
      style={style}
      className={cn(
        "group block rounded-chunk border border-border bg-surface p-5 shadow-soft transition-all duration-200 hover:-translate-y-1 hover:shadow-pop active:translate-y-0",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <span
          className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl"
          style={{ background: t.soft, color: t.deep }}
        >
          <Icon className="h-7 w-7" strokeWidth={2.4} />
          <span
            className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full text-xs font-bold text-white shadow-soft"
            style={{ background: t.base }}
          >
            {stop}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[0.66rem] font-bold uppercase tracking-wide" style={{ color: t.deep }}>
            {scenario.category} · {scenario.categoryZh}
          </span>
          <h3 className="mt-0.5 truncate font-display text-xl font-semibold text-ink">{scenario.title}</h3>
          <p className="truncate text-sm text-muted">
            {scenario.titleZh} · {scenario.subtitle}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs font-semibold text-muted">
          <Stars value={scenario.difficulty} color={t.base} />
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {scenario.minutes} min
          </span>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold"
            style={{ background: t.soft, color: t.deep }}
          >
            +{xp} XP
          </span>
        </div>
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-white transition-transform group-hover:translate-x-0.5"
          style={{ background: t.base }}
        >
          <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
        </span>
      </div>
    </Link>
  );
}

function Stars({ value, color }: { value: number; color: string }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`难度 ${value} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-3.5 w-3.5" strokeWidth={0} fill={i < value ? color : "#ead9c2"} />
      ))}
    </span>
  );
}
