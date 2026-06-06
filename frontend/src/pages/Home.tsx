import { useState } from "react";
import { Flame } from "lucide-react";
import { BuddyHero } from "../components/BuddyHero";
import { JourneyPath } from "../components/JourneyPath";
import { Wordmark } from "../components/Wordmark";
import { BackendStatus } from "../components/BackendStatus";
import { StatChip } from "../components/StatChip";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { chapters, getScenario, type Scenario } from "../data/scenarios";
import { userProgress } from "../data/progress";
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
  const [activeChapter, setActiveChapter] = useState(0);
  const chapter = chapters[activeChapter];
  const chapterScenarios = chapter.ids
    .map((cid) => getScenario(cid))
    .filter((s): s is Scenario => Boolean(s));

  return (
    <div className="min-h-screen pb-24">
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
          <p className="eyebrow">Your journey · 闯关地图</p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">今天来练哪一关？</h2>

          <div className="mt-4 flex flex-wrap gap-2">
            {chapters.map((ch, i) => (
              <button
                key={ch.title}
                type="button"
                onClick={() => setActiveChapter(i)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-bold transition-transform active:translate-y-0.5",
                  i === activeChapter
                    ? "bg-coral text-primary-fg shadow-pop"
                    : "border border-border bg-surface text-ink shadow-soft hover:-translate-y-0.5",
                )}
              >
                {ch.titleZh}
              </button>
            ))}
          </div>

          <p className="mt-3 text-sm font-semibold text-muted">
            {chapter.title} · {chapterScenarios.length} 关
          </p>

          <JourneyPath key={chapter.title} scenarios={chapterScenarios} />
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
        <span className="text-sm font-semibold text-muted">Spoken · 和 Pip 一起练英语口语</span>
        <BackendStatus />
      </footer>
      <BottomNav />
    </div>
  );
}
