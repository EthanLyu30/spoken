import { useEffect, useState, type ReactNode } from "react";
import {
  Award,
  Flame,
  Loader2,
  Lock,
  MessageSquare,
  Mic,
  Repeat,
  Rocket,
  RotateCcw,
  Sparkles,
  Star,
  Timer,
  Trophy,
  Volume2,
} from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import type { EChartsOption } from "echarts";
import {
  getPractice,
  getSessions,
  getStats,
  getWords,
  type PracticeRecord,
  type SessionSummary,
  type Stats,
  type Word,
} from "../lib/api";
import { EChart } from "../components/EChart";
import { listBrowserVoices, primeBrowserVoices, speakText } from "../lib/speech";
import { useVoice, VOICE_OPTIONS, type VoiceEngine } from "../store/voice";
import { resetOnboarding } from "../components/Onboarding";
import { tokens } from "../lib/tokens";
import { cn } from "../lib/utils";

export default function Profile() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [practice, setPractice] = useState<PracticeRecord[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    getSessions(ctrl.signal).then(setSessions).catch(() => undefined);
    getWords(ctrl.signal).then(setWords).catch(() => undefined);
    getStats(ctrl.signal).then(setStats).catch(() => undefined);
    getPractice(undefined, 100, ctrl.signal).then(setPractice).catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const sessionCount = sessions.length;
  const wordCount = words.length;
  const best = sessions.reduce((m, s) => Math.max(m, s.overall), 0);
  const avg = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + s.overall, 0) / sessions.length)
    : 0;
  const distinct = new Set(sessions.map((s) => s.scenario_id)).size;

  const level = stats?.level ?? 1;
  const xp = stats?.xp ?? 0;
  const xpNext = stats?.xp_to_next ?? 250;
  const streak = stats?.streak_days ?? 0;
  const todayCount = stats?.today_count ?? 0;
  const todayGoal = stats?.today_goal ?? 3;
  const goalPct = Math.min(100, (todayCount / todayGoal) * 100);

  const bestPron = practice
    .filter((p) => p.kind === "pronunciation")
    .reduce((m, p) => Math.max(m, p.score), 0);
  const interviewCount = practice.filter((p) => p.kind === "interview").length;
  const reviewedCount = words.filter((w) => (w.box ?? 0) > 0).length;

  const badges = [
    { icon: Star, title: "初次开口", desc: "完成第一次对话", earned: sessionCount >= 1 },
    { icon: Flame, title: "三日连击", desc: "连续练习 3 天", earned: streak >= 3 },
    { icon: Flame, title: "一周不断", desc: "连续练习 7 天", earned: streak >= 7 },
    { icon: MessageSquare, title: "话痨", desc: "累计 10 次对话", earned: sessionCount >= 10 },
    { icon: Sparkles, title: "词汇收藏家", desc: "收藏 10 个词", earned: wordCount >= 10 },
    { icon: Sparkles, title: "百词斩", desc: "收藏 50 个词", earned: wordCount >= 50 },
    { icon: Repeat, title: "复习标兵", desc: "复习过 10 个词", earned: reviewedCount >= 10 },
    { icon: Mic, title: "发音达人", desc: "跟读得分 ≥ 90", earned: bestPron >= 90 },
    { icon: Timer, title: "口语考官", desc: "完成 3 次限时问答", earned: interviewCount >= 3 },
    { icon: Trophy, title: "高分达人", desc: "单次总分 ≥ 90", earned: best >= 90 },
    { icon: Award, title: "场景探索者", desc: "体验 5 个不同场景", earned: distinct >= 5 },
    { icon: Rocket, title: "升级达人", desc: "等级达到 Lv.3", earned: level >= 3 },
  ];
  const earnedCount = badges.filter((b) => b.earned).length;

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <main className="mx-auto w-full max-w-3xl px-5 py-8">
        <section className="card flex flex-col items-center gap-3 p-6 text-center">
          <Buddy mood="happy" size={120} />
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink">我的小屋</h1>
            <p className="text-sm text-muted">Lv.{level} · 和 Pip 一起成长</p>
          </div>
          <div className="w-full max-w-xs">
            <div className="mb-1 flex justify-between text-xs font-semibold text-muted">
              <span>Lv.{level}</span>
              <span className="tabnum">
                {xp} / {xpNext} XP
              </span>
            </div>
            <ProgressBar value={(xp / xpNext) * 100} color="var(--tangerine)" />
          </div>
        </section>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={<MessageSquare className="h-4 w-4" />} value={sessionCount} label="练习次数" />
          <Stat icon={<Sparkles className="h-4 w-4" />} value={wordCount} label="收藏词" />
          <Stat icon={<Flame className="h-4 w-4" />} value={streak} label="连续天数" />
          <Stat icon={<Trophy className="h-4 w-4" />} value={avg || "—"} label="平均分" />
        </div>

        <StreakCard streak={streak} />

        <section className="card mt-5 p-6">
          <div className="flex items-center gap-4">
            <Ring pct={goalPct} size={72} color="var(--leaf)">
              <div className="font-display text-sm font-bold tabnum text-ink">
                {todayCount}/{todayGoal}
              </div>
            </Ring>
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">每日挑战</h2>
              <p className="text-sm text-muted">
                {todayCount >= todayGoal
                  ? "今天已达标，太棒了！"
                  : `今天再完成 ${todayGoal - todayCount} 次练习就达标啦！`}
              </p>
            </div>
          </div>
        </section>

        <PracticeHistory records={practice} />

        <VoiceSettings />

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

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => {
              resetOnboarding();
              window.location.reload();
            }}
            className="text-sm font-semibold text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            重新查看新手引导
          </button>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

const ENGINES: { id: VoiceEngine; label: string; hint: string }[] = [
  { id: "browser", label: "浏览器语音", hint: "更自然、连贯（推荐）" },
  { id: "iflytek", label: "讯飞云端", hint: "云端音色，可跟随场景" },
];

function VoiceSettings() {
  const {
    engine,
    vcn,
    browserVoiceURI,
    speed,
    pitch,
    setEngine,
    setVcn,
    setBrowserVoiceURI,
    setSpeed,
    setPitch,
    reset,
  } = useVoice();
  const [previewing, setPreviewing] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const custom = vcn != null || browserVoiceURI != null || speed != null || pitch != null;

  useEffect(() => {
    setBrowserVoices(listBrowserVoices());
    primeBrowserVoices(() => setBrowserVoices(listBrowserVoices()));
  }, []);

  const speedLabel = (speed ?? 50) <= 40 ? "偏慢" : (speed ?? 50) >= 62 ? "偏快" : "适中";
  const pitchLabel = (pitch ?? 50) <= 44 ? "低沉" : (pitch ?? 50) >= 58 ? "偏高" : "适中";

  function preview() {
    if (previewing) return;
    setPreviewing(true);
    const s = speakText("Hi! I'm Pip. Let's practice English together — you've got this!");
    s.done.finally(() => setPreviewing(false));
  }

  return (
    <section className="card mt-5 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">语音设置</h2>
        {custom && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 重置
          </button>
        )}
      </div>

      <label className="mb-1.5 block text-sm font-bold text-ink">朗读引擎</label>
      <div className="mb-1.5 grid grid-cols-2 gap-2">
        {ENGINES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setEngine(e.id)}
            className={cn(
              "rounded-2xl border px-3 py-2.5 text-left transition-transform active:translate-y-0.5",
              engine === e.id
                ? "border-coral bg-coral/10 shadow-soft"
                : "border-border bg-surface hover:-translate-y-0.5",
            )}
          >
            <span className="block text-sm font-bold text-ink">{e.label}</span>
            <span className="block text-[0.66rem] text-muted">{e.hint}</span>
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        {engine === "browser"
          ? "用你设备/浏览器自带的英文语音，朗读更连贯自然。"
          : "用讯飞云端发音人，不选音色时跟随每个场景的语气。"}
      </p>

      <label className="mb-1.5 block text-sm font-bold text-ink">音色</label>
      {engine === "browser" ? (
        <select
          value={browserVoiceURI ?? ""}
          onChange={(e) => setBrowserVoiceURI(e.target.value || null)}
          className="mb-5 w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-ink outline-none focus:border-coral"
        >
          <option value="">自动（最自然）</option>
          {browserVoices.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={vcn ?? ""}
          onChange={(e) => setVcn(e.target.value || null)}
          className="mb-5 w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-ink outline-none focus:border-coral"
        >
          <option value="">跟随场景（推荐）</option>
          {VOICE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {engine === "browser" && browserVoices.length === 0 && (
        <p className="-mt-3 mb-4 text-xs text-muted">
          此浏览器暂未提供英文语音，可改用「讯飞云端」。
        </p>
      )}

      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-bold text-ink">语速</span>
        <span className="font-semibold text-muted">{speedLabel}</span>
      </div>
      <input
        type="range"
        min={20}
        max={85}
        value={speed ?? 50}
        onChange={(e) => setSpeed(Number(e.target.value))}
        className="mb-5 w-full"
        style={{ accentColor: "var(--coral)" }}
      />

      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-bold text-ink">音调</span>
        <span className="font-semibold text-muted">{pitchLabel}</span>
      </div>
      <input
        type="range"
        min={30}
        max={75}
        value={pitch ?? 50}
        onChange={(e) => setPitch(Number(e.target.value))}
        className="mb-5 w-full"
        style={{ accentColor: "var(--coral)" }}
      />

      <button
        type="button"
        onClick={preview}
        disabled={previewing}
        className="inline-flex items-center gap-1.5 rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-primary-fg shadow-pop transition-transform active:translate-y-0.5 disabled:opacity-60"
      >
        {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Volume2 className="h-4 w-4" />}
        {previewing ? "播放中…" : "试听"}
      </button>
    </section>
  );
}

function StreakCard({ streak }: { streak: number }) {
  const milestones = [3, 7, 14, 30];
  const next = milestones.find((m) => m > streak);
  return (
    <section className="card mt-5 flex items-center gap-4 p-6">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#fff0dd]">
        <Flame className="h-8 w-8 text-[#e07f1c]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-lg font-semibold text-ink">🔥 {streak} 天连击</p>
        <p className="mt-0.5 text-sm text-muted">
          {streak === 0
            ? "今天开练，点燃你的第一团火苗！"
            : next
              ? `再坚持 ${next - streak} 天，解锁 ${next} 天里程碑！`
              : "连击王者，继续保持！"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {milestones.map((m) => (
            <span
              key={m}
              className={cn(
                "rounded-full px-2 py-0.5 text-[0.6rem] font-bold",
                streak >= m ? "bg-[#ffe0b8] text-[#e07f1c]" : "bg-surface-2 text-muted",
              )}
            >
              {m} 天
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function lineOption(records: PracticeRecord[], max: number, color: string): EChartsOption {
  const trend = [...records].reverse(); // oldest -> newest
  return {
    grid: { left: 34, right: 16, top: 16, bottom: 24 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: trend.map((_, i) => `#${i + 1}`),
      axisLine: { lineStyle: { color: tokens.border } },
      axisLabel: { color: tokens.muted },
    },
    yAxis: {
      type: "value",
      min: 0,
      max,
      splitLine: { lineStyle: { color: tokens.border } },
      axisLabel: { color: tokens.muted },
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: trend.map((r) => r.score),
        symbolSize: 7,
        lineStyle: { color, width: 3 },
        itemStyle: { color },
        areaStyle: { color, opacity: 0.14 },
      },
    ],
  };
}

function PracticeHistory({ records }: { records: PracticeRecord[] }) {
  const pron = records.filter((r) => r.kind === "pronunciation");
  const intv = records.filter((r) => r.kind === "interview");

  return (
    <section className="card mt-5 p-6">
      <h2 className="font-display text-lg font-semibold text-ink">练习记录</h2>
      {records.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          还没有跟读 / 限时问答记录。去「金句」点跟读评分，或试试「限时问答」，这里就会出现你的成长曲线。
        </p>
      ) : (
        <div className="mt-2 space-y-4">
          {pron.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink">跟读发音分 · /100（最近 {pron.length} 次）</p>
              <EChart option={lineOption(pron, 100, tokens.coral)} height={190} className="mt-1" />
            </div>
          )}
          {intv.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-ink">限时问答 · /6（最近 {intv.length} 次）</p>
              <EChart option={lineOption(intv, 6, "#2bb3a3")} height={190} className="mt-1" />
            </div>
          )}
        </div>
      )}
    </section>
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
