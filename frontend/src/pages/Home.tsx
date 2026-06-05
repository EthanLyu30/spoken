import { Flame } from "lucide-react";
import { BuddyHero } from "../components/BuddyHero";
import { ScenarioCard } from "../components/ScenarioCard";
import { Wordmark } from "../components/Wordmark";
import { BackendStatus } from "../components/BackendStatus";
import { StatChip } from "../components/StatChip";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { scenarios } from "../data/scenarios";
import { userProgress } from "../data/progress";
import { themeFor } from "../lib/theme";
import { cn } from "../lib/utils";

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 6) return "夜深啦，练一小会儿就早点休息～";
  if (h < 12) return "早上好！开口练几句吧 ☀️";
  if (h < 18) return "下午好，继续保持手感！";
  return "晚上好，来热热身吧 🌙";
}

export default function Home() {
  const greeting = greetingFor(new Date());

  return (
    <div className="min-h-screen">
      <PlayfulBackground />

      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 pt-6 sm:px-8">
        <Wordmark />
        <StatChip
          icon={<Flame className="h-4 w-4" />}
          value={userProgress.streakDays}
          label="天连续"
          tint="#fff0dd"
          fg="#e07f1c"
        />
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
        <div className="animate-rise">
          <BuddyHero greeting={greeting} />
        </div>

        <section className="mt-12">
          <div className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Your journey · 闯关地图</p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">今天来练哪一关？</h2>
            </div>
            <span className="hidden text-sm font-semibold text-muted sm:block">
              {scenarios.length} 个场景 · 跟着 Pip 一路通关
            </span>
          </div>

          <div className="relative">
            {/* dotted journey path */}
            <span
              aria-hidden
              className="absolute bottom-3 left-[1.85rem] top-3 w-1 -translate-x-1/2 rounded-full md:left-1/2"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to bottom, var(--border) 0 9px, transparent 9px 20px)",
              }}
            />
            <div className="flex flex-col gap-6">
              {scenarios.map((s, i) => {
                const right = i % 2 === 1;
                const t = themeFor(s.id);
                return (
                  <div key={s.id} className="relative md:grid md:grid-cols-2 md:gap-10">
                    <span
                      aria-hidden
                      className="absolute left-[1.85rem] top-7 z-10 h-5 w-5 -translate-x-1/2 rounded-full border-4 border-bg md:left-1/2"
                      style={{ background: t.base }}
                    />
                    <div className={cn("pl-14 md:pl-0", right ? "md:col-start-2" : "md:col-start-1")}>
                      <ScenarioCard
                        scenario={s}
                        stop={i + 1}
                        className="animate-rise"
                        style={{ animationDelay: `${i * 0.07}s` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
        <span className="text-sm font-semibold text-muted">Spoken · 和 Pip 一起练英语口语</span>
        <BackendStatus />
      </footer>
    </div>
  );
}
