import { Link } from "react-router-dom";
import { ArrowLeft, RotateCcw, Sparkles } from "lucide-react";
import { Buddy } from "../components/Buddy";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Button } from "../components/ui/Button";
import { PlayfulBackground } from "../components/PlayfulBackground";

const skills = [
  { label: "发音 · Pronunciation", score: 88, color: "#ff6f5e" },
  { label: "流利度 · Fluency", score: 82, color: "#ff9f45" },
  { label: "语法 · Grammar", score: 79, color: "#41c08c" },
  { label: "词汇 · Vocabulary", score: 85, color: "#57b7e8" },
];
const newWords = ["brew", "to go", "a splash of milk", "for here", "settle the tab"];
const overall = Math.round(skills.reduce((sum, s) => sum + s.score, 0) / skills.length);
const xpEarned = 120;

export default function Report() {
  return (
    <div className="min-h-screen">
      <PlayfulBackground celebrate />

      <header className="mx-auto w-full max-w-3xl px-5 pt-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5"
        >
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        <section className="relative overflow-hidden rounded-huge border border-border bg-surface p-6 shadow-pop md:p-9">
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
            <Buddy mood="cheer" size={132} className="mx-auto" />
            <div className="text-center md:text-left">
              <p className="eyebrow">Session complete · 本次小结</p>
              <h1 className="mt-1 font-display text-3xl font-semibold text-ink">干得漂亮！</h1>
              <p className="mt-1 text-muted">Nice work — you kept the whole conversation going in English.</p>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fff5d8] px-3 py-1.5 text-sm font-bold text-[#cf9612]">
                <Sparkles className="h-4 w-4" /> +{xpEarned} XP
              </span>
            </div>
            <Ring pct={overall} size={120} stroke={12} color="var(--coral)">
              <div className="text-center">
                <div className="font-display text-3xl font-bold leading-none tabnum text-ink">{overall}</div>
                <div className="text-[0.62rem] font-bold uppercase text-muted">总分</div>
              </div>
            </Ring>
          </div>
        </section>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">能力拆解 · Skills</h2>
            <div className="mt-4 space-y-4">
              {skills.map((s) => (
                <div key={s.label}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-semibold text-ink">{s.label}</span>
                    <span className="font-bold tabnum" style={{ color: s.color }}>
                      {s.score}
                    </span>
                  </div>
                  <ProgressBar value={s.score} color={s.color} height={10} />
                </div>
              ))}
            </div>
          </section>

          <section className="card p-6">
            <h2 className="font-display text-lg font-semibold text-ink">收集到的新词 · New words</h2>
            <p className="mt-1 text-sm text-muted">这次对话里你用到 / 学到的表达，已加入你的词袋。</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {newWords.map((w) => (
                <span
                  key={w}
                  className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-sm font-semibold text-ink"
                >
                  {w}
                </span>
              ))}
            </div>
            <div className="mt-6 rounded-2xl bg-surface-2 p-4">
              <p className="text-sm leading-relaxed text-ink">
                <span className="font-bold">Pip 的建议：</span>
                下次试着把句子说得更完整一点，多用 “because…” 解释原因，会更自然哦！
              </p>
            </div>
          </section>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/practice/cafe">
            <Button size="lg">
              <RotateCcw className="h-5 w-5" /> 再来一局
            </Button>
          </Link>
          <Link to="/">
            <Button size="lg" variant="soft">
              回首页
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
