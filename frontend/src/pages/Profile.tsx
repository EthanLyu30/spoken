import { useEffect, useState, type ReactNode } from "react";
import {
  Award,
  Flame,
  Loader2,
  Lock,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Star,
  Trophy,
  Volume2,
} from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import { getSessions, getWords, type SessionSummary, type Word } from "../lib/api";
import { listBrowserVoices, primeBrowserVoices, speakText } from "../lib/speech";
import { useVoice, VOICE_OPTIONS, type VoiceEngine } from "../store/voice";
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
