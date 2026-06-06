import { useEffect, useState, type ReactNode } from "react";
import { Award, Flame, Lock, MessageSquare, Sparkles, Star, Trophy } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import { getSessions, getWords, type SessionSummary, type Word } from "../lib/api";
import { userProgress } from "../data/progress";
import { cn } from "../lib/utils";

export default function Profile() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [words, setWords] = useState<Word[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    getSessions(ctrl.signal).then(setSessions).catch(() => undefined);
    getWords(ctrl.signal).then(setWords).catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const p = userProgress;
  const sessionCount = sessions.length;
  const wordCount = words.length;
  const best = sessions.reduce((m, s) => Math.max(m, s.overall), 0);
  const avg = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + s.overall, 0) / sessions.length)
    : 0;
  const distinct = new Set(sessions.map((s) => s.scenario_id)).size;
  const goalPct = Math.min(100, (p.todayMinutes / p.goalMinutes) * 100);

  const badges = [
    { icon: Star, title: "初次开口", desc: "完成第一次对话", earned: sessionCount >= 1 },
    { icon: Flame, title: "三日连击", desc: "连续练习 3 天", earned: p.streakDays >= 3 },
    { icon: MessageSquare, title: "话痨", desc: "累计 10 次对话", earned: sessionCount >= 10 },
    { icon: Sparkles, title: "词汇收藏家", desc: "收藏 10 个词", earned: wordCount >= 10 },
    { icon: Trophy, title: "高分达人", desc: "单次总分 ≥ 90", earned: best >= 90 },
    { icon: Award, title: "场景探索者", desc: "体验 5 个不同场景", earned: distinct >= 5 },
  ];
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <Buddy mood="happy" size={120} />
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">{p.name} 的小屋</h1>
            <p className="text-sm text-muted">Lv.{p.level} · 和 Pip 一起成长</p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1 flex justify-between text-xs font-semibold text-muted">
              <span>Lv.{p.level}</span>
              <span className="tabnum">
                {p.xp} / {p.xpToNext} XP
              </span>
            </div>
            <ProgressBar value={(p.xp / p.xpToNext) * 100} color="var(--tangerine)" />
          </div>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<MessageSquare className="h-4 w-4" />} value={sessionCount} label="练习次数" />
          <Stat icon={<Sparkles className="h-4 w-4" />} value={wordCount} label="收藏词" />
          <Stat icon={<Flame className="h-4 w-4" />} value={p.streakDays} label="连续天数" />
          <Stat icon={<Trophy className="h-4 w-4" />} value={avg || "—"} label="平均分" />
        </div>

        <section className="card mt-5 p-6">
          <div className="flex items-center gap-4">
            <Ring pct={goalPct} size={72} color="var(--leaf)">
              <div className="font-display text-sm font-bold tabnum text-ink">
                {p.todayMinutes}/{p.goalMinutes}
              </div>
            </Ring>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">每日挑战</h2>
              <p className="text-sm text-muted">
                {p.todayMinutes >= p.goalMinutes
                  ? "今天已达标，太棒了！"
                  : `今天再练 ${p.goalMinutes - p.todayMinutes} 分钟就达标啦！`}
              </p>
            </div>
          </div>
        </section>

        <section className="card mt-5 p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">成就徽章</h2>
            <span className="text-sm font-semibold text-muted">
              {earnedCount}/{badges.length}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {badges.map((b) => (
              <div
                key={b.title}
                className={cn(
                  "rounded-2xl border p-4 text-center",
                  b.earned ? "border-border bg-surface-2" : "border-dashed border-border opacity-60",
                )}
              >
                <span
                  className="mx-auto grid h-12 w-12 place-items-center rounded-full"
                  style={{
                    background: b.earned ? "#fff5d8" : "var(--surface-2)",
                    color: b.earned ? "#cf9612" : "var(--muted)",
                  }}
                >
                  {b.earned ? <b.icon className="h-6 w-6" /> : <Lock className="h-5 w-5" />}
                </span>
                <p className="mt-2 text-sm font-bold text-ink">{b.title}</p>
                <p className="text-[0.66rem] text-muted">{b.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="card flex flex-col items-center gap-1 p-4">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-coral-deep">
        {icon}
      </span>
      <span className="font-display text-xl font-bold tabnum text-ink">{value}</span>
      <span className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}
