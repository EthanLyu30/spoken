import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "../lib/utils";
import { scenarioIcons } from "../lib/icons";
import { difficultyLabel, type Scenario } from "../data/scenarios";

function DifficultyDots({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`难度 ${value} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < value ? "bg-primary" : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

interface ScenarioCardProps {
  scenario: Scenario;
  index: number;
  featured?: boolean;
}

export function ScenarioCard({ scenario, index, featured }: ScenarioCardProps) {
  const Icon = scenarioIcons[scenario.icon];
  const num = String(index).padStart(2, "0");
  const href = `/practice/${scenario.id}`;

  if (featured) {
    return (
      <Link
        to={href}
        className="group relative block overflow-hidden rounded bg-primary p-7 text-primary-fg shadow-clip transition-transform duration-200 hover:-translate-y-0.5 md:p-9"
      >
        <Icon className="pointer-events-none absolute -right-6 -top-8 h-44 w-44 text-primary-fg opacity-10" />
        <span className="eyebrow !text-accent">Featured · 今日推荐</span>
        <h2 className="mt-4 text-4xl md:text-5xl">
          <span className="hl-static">{scenario.title}</span>
        </h2>
        <p className="mt-2 font-sc text-lg text-primary-fg opacity-80">
          {scenario.titleZh} · {scenario.subtitle}
        </p>
        <p className="mt-5 max-w-md text-primary-fg opacity-90">{scenario.goal}</p>
        <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 font-meta text-sm uppercase tracking-wide text-surface">
            开始练习 <ArrowRight className="h-4 w-4" />
          </span>
          <span className="eyebrow !text-primary-fg opacity-70">
            {difficultyLabel(scenario.difficulty)} · {scenario.minutes} min
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={href}
      className="group block rounded border border-border bg-surface p-5 shadow-clip transition-transform duration-200 hover:-translate-y-0.5 hover:border-primary"
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">
          {num} · {scenario.category} · {scenario.categoryZh}
        </span>
        <Icon className="h-4 w-4 text-muted" />
      </div>
      <h3 className="mt-3 text-2xl">
        <span className="hl">{scenario.title}</span>
      </h3>
      <p className="mt-1 font-sc text-sm text-muted">{scenario.subtitle}</p>
      <div className="my-4 border-t border-border" />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DifficultyDots value={scenario.difficulty} />
          <span className="eyebrow !text-muted">{scenario.minutes} 分钟</span>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-surface transition-transform duration-200 group-hover:translate-x-0.5">
          <ArrowRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
