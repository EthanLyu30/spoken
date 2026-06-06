import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Sparkles, Target } from "lucide-react";
import { Buddy } from "./Buddy";
import { Ring } from "./ui/Ring";
import { ProgressBar } from "./ui/ProgressBar";
import { StatChip } from "./StatChip";
import { getWords } from "../lib/api";
import { userProgress } from "../data/progress";

interface BuddyHeroProps {
  greeting: string;
}

/** Home hero: Pip greets the learner, with level / XP / streak / daily goal. */
export function BuddyHero({ greeting }: BuddyHeroProps) {
  const p = userProgress;
  const xpPct = (p.xp / p.xpToNext) * 100;
  const goalPct = (p.todayMinutes / p.goalMinutes) * 100;
  const [wordCount, setWordCount] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getWords(ctrl.signal)
      .then((ws) => setWordCount(ws.filter((w) => w.kind !== "sentence").length))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  return (
    <section className="relative overflow-hidden rounded-huge border border-border bg-surface p-6 shadow-pop md:p-9">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full"
        style={{ background: "radial-gradient(circle,#fff0d6,transparent 70%)" }}
      />
      <div className="relative grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
        {/* Buddy + speech bubble */}
        <div className="flex items-center gap-3">
          <Buddy mood="happy" size={148} className="shrink-0" />
          <div className="bubble relative max-w-[15rem] rounded-3xl bg-surface-2 px-5 py-4 shadow-soft">
            <p className="text-[0.66rem] font-bold uppercase tracking-wide text-coral-deep">Pip says</p>
            <p className="mt-1 font-display text-lg font-semibold leading-snug text-ink">{greeting}</p>
            <span className="absolute -left-1.5 top-12 h-4 w-4 rotate-45 bg-surface-2" />
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Ring pct={goalPct} color="var(--leaf)" size={84}>
              <div className="text-center">
                <div className="font-display text-lg font-bold leading-none tabnum text-ink">{p.todayMinutes}</div>
                <div className="text-[0.6rem] font-bold uppercase text-muted">/ {p.goalMinutes}m</div>
              </div>
            </Ring>
            <div className="flex-1">
              <div className="mb-1.5 flex items-end justify-between">
                <span className="font-display text-lg font-semibold text-ink">Lv.{p.level}</span>
                <span className="text-xs font-semibold tabnum text-muted">
                  {p.xp} / {p.xpToNext} XP
                </span>
              </div>
              <ProgressBar value={xpPct} color="var(--tangerine)" />
              <p className="mt-1.5 text-xs text-muted">距离下一级还差 {p.xpToNext - p.xp} XP</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <StatChip icon={<Flame className="h-4 w-4" />} value={p.streakDays} label="天连续" tint="#fff0dd" fg="#e07f1c" />
            <Link to="/words" className="transition-transform hover:-translate-y-0.5" aria-label="打开生词本">
              <StatChip
                icon={<Sparkles className="h-4 w-4" />}
                value={wordCount ?? p.wordsLearned}
                label="收集词"
                tint="#e6f4fc"
                fg="#2c8fc6"
              />
            </Link>
            <Link to="/progress" className="transition-transform hover:-translate-y-0.5" aria-label="查看进度">
              <StatChip
                icon={<Target className="h-4 w-4" />}
                value={`${Math.round(goalPct)}%`}
                label="今日目标"
                tint="#e2f6ee"
                fg="#2b9b70"
              />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
