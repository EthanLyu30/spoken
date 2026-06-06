import { Link } from "react-router-dom";
import { Flame } from "lucide-react";
import { BuddyHero } from "../components/BuddyHero";
import { JourneyPath } from "../components/JourneyPath";
import { Wordmark } from "../components/Wordmark";
import { BackendStatus } from "../components/BackendStatus";
import { StatChip } from "../components/StatChip";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { scenarios } from "../data/scenarios";
import { userProgress } from "../data/progress";

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
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Link
            to="/words"
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            生词本
          </Link>
          <Link
            to="/progress"
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            我的进度
          </Link>
          <StatChip
            icon={<Flame className="h-4 w-4" />}
            value={userProgress.streakDays}
            label="天连续"
            tint="#fff0dd"
            fg="#e07f1c"
          />
        </div>
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

          <JourneyPath scenarios={scenarios} />
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-8 sm:px-8">
        <span className="text-sm font-semibold text-muted">Spoken · 和 Pip 一起练英语口语</span>
        <BackendStatus />
      </footer>
    </div>
  );
}
