import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Sparkles, Target } from "lucide-react";
import { Buddy } from "./Buddy";
import { Ring } from "./ui/Ring";
import { ProgressBar } from "./ui/ProgressBar";
import { StatChip } from "./StatChip";
import { getStats, type Stats } from "../lib/api";
import { useWords } from "../store/words";

interface BuddyHeroProps {
  greeting: string;
}

/** Home hero: Pip greets the learner, with real level / XP / streak / daily goal. */
export function BuddyHero({ greeting }: BuddyHeroProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const words = useWords((s) => s.words);
  const ensureLoaded = useWords((s) => s.ensureLoaded);
  const wordCount = words.filter((w) => w.kind !== "sentence").length;

  useEffect(() => {
    const ctrl = new AbortController();
    getStats(ctrl.signal).then(setStats).catch(() => undefined);
    ensureLoaded();
    return () => ctrl.abort();
  }, [ensureLoaded]);

  const level = stats?.level ?? 1;
  const xp = stats?.xp ?? 0;
  const xpNext = stats?.xp_to_next ?? 250;
  const streak = stats?.streak_days ?? 0;
  const todayCount = stats?.today_count ?? 0;
  const todayGoal = stats?.today_goal ?? 3;
  const xpPct = (xp / xpNext) * 100;
  const goalPct = Math.min(100, (todayCount / todayGoal) * 100);

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
                <div className="font-display text-lg font-bold leading-none tabnum text-ink">{todayCount}</div>
                <div className="text-[0.6rem] font-bold uppercase text-muted">/ {todayGoal} 次</div>
              </div>
            </Ring>
            <div className="flex-1">
              <div className="mb-1.5 flex items-end justify-between">
                <span className="font-display text-lg font-semibold text-ink">Lv.{level}</span>
                <span className="text-xs font-semibold tabnum text-muted">
                  {xp} / {xpNext} XP
                </span>
              </div>
              <ProgressBar value={xpPct} color="var(--tangerine)" />
              <p className="mt-1.5 text-xs text-muted">距离下一级还差 {Math.max(0, xpNext - xp)} XP</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            <StatChip icon={<Flame className="h-4 w-4" />} value={streak} label="天连续" tint="#fff0dd" fg="#e07f1c" />
            <Link to="/words" className="transition-transform hover:-translate-y-0.5" aria-label="打开生词本">
              <StatChip
                icon={<Sparkles className="h-4 w-4" />}
                value={wordCount}
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
