import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { Buddy } from "../components/Buddy";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Button } from "../components/ui/Button";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { useSession } from "../store/session";
import { postFeedback, postSession, type FeedbackResponse } from "../lib/api";
import { getScenario } from "../data/scenarios";

const SCORE_COLORS = ["#ff6f5e", "#ff9f45", "#41c08c", "#57b7e8"];

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

// Dedupe saves across StrictMode remounts / re-renders.
const savedSignatures = new Set<string>();

export default function Report() {
  const scenarioId = useSession((s) => s.scenarioId);
  const messages = useSession((s) => s.messages);
  const scenario = scenarioId ? getScenario(scenarioId) : undefined;
  const hasSession = !!scenarioId && messages.some((m) => m.role === "user");

  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [loading, setLoading] = useState(hasSession);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (!hasSession || !scenarioId) return;
    const ctrl = new AbortController();
    const myId = ++reqId.current;
    setLoading(true);
    setError(null);
    postFeedback(scenarioId, messages, ctrl.signal)
      .then((f) => {
        if (myId !== reqId.current) return;
        setFeedback(f);
        const sig = `${scenarioId}|${messages.length}|${f.overall}`;
        if (!savedSignatures.has(sig)) {
          savedSignatures.add(sig);
          postSession({
            scenario_id: scenarioId,
            messages,
            overall: f.overall,
            summary: f.summary,
            tip: f.tip,
            scores: f.scores,
          }).catch(() => undefined);
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted && myId === reqId.current)
          setError("生成小结失败，请确认后端在运行后重试。");
      })
      .finally(() => {
        if (!ctrl.signal.aborted && myId === reqId.current) setLoading(false);
      });
    return () => ctrl.abort();
    // Analyse the captured session once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasSession) {
    return (
      <div className="grid min-h-screen place-items-center px-5">
        <PlayfulBackground />
        <div className="text-center">
          <Buddy mood="happy" size={150} className="mx-auto" />
          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">还没有可复盘的对话</h1>
          <p className="mt-2 text-muted">先去和 Pip 聊一段，这里就会出现你的课后小结。</p>
          <Link to="/" className="mt-6 inline-block">
            <Button size="lg">去挑一个场景</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PlayfulBackground celebrate={!!feedback} />

      <header className="mx-auto w-full max-w-3xl px-5 pt-6">
        <Link to="/" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        {loading && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="talking" size={120} />
            <h1 className="mt-3 font-display text-xl font-semibold text-ink">Pip 正在帮你复盘…</h1>
            <p className="mt-1 text-sm text-muted">正在分析这次对话的发挥</p>
          </section>
        )}

        {error && !loading && (
          <section className="card grid place-items-center gap-4 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="font-semibold text-ink">{error}</p>
            <div className="flex gap-3">
              <Link to={`/practice/${scenarioId}`}>
                <Button variant="soft">回到对话</Button>
              </Link>
              <Link to="/">
                <Button variant="ghost">回首页</Button>
              </Link>
            </div>
          </section>
        )}

        {feedback && !loading && (
          <>
            <section className="relative overflow-hidden rounded-huge border border-border bg-surface p-6 shadow-pop md:p-9">
              <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
                <Buddy mood="cheer" size={128} className="mx-auto" />
                <div className="text-center md:text-left">
                  <p className="eyebrow">课后小结 · Debrief{scenario ? ` · ${scenario.titleZh}` : ""}</p>
                  <h1 className="mt-1 font-display text-2xl font-semibold leading-snug text-ink md:text-3xl">
                    {feedback.summary}
                  </h1>
                  <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fff5d8] px-3 py-1.5 text-sm font-bold text-[#cf9612]">
                    <Sparkles className="h-4 w-4" /> +{40 + Math.round(feedback.overall)} XP
                  </span>
                </div>
                <Ring pct={feedback.overall} size={118} stroke={12} color="var(--coral)">
                  <div className="text-center">
                    <div className="font-display text-3xl font-bold leading-none tabnum text-ink">
                      {feedback.overall}
                    </div>
                    <div className="text-[0.62rem] font-bold uppercase text-muted">总分</div>
                  </div>
                </Ring>
              </div>
            </section>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">能力拆解 · Skills</h2>
                <div className="mt-4 space-y-4">
                  {feedback.scores.map((s, i) => (
                    <div key={s.key}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">
                          {s.label_zh} · {s.label_en}
                        </span>
                        <span
                          className="font-bold tabnum"
                          style={{ color: SCORE_COLORS[i % SCORE_COLORS.length] }}
                        >
                          {s.score}
                        </span>
                      </div>
                      <ProgressBar value={s.score} color={SCORE_COLORS[i % SCORE_COLORS.length]} height={10} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">纠错 · Corrections</h2>
                {feedback.corrections.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">这次没有明显的语法错误，很棒！</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {feedback.corrections.map((c, i) => (
                      <div key={i} className="rounded-2xl bg-surface-2 p-4">
                        <p className="text-sm text-muted line-through">{c.original}</p>
                        <p className="mt-1 text-sm font-bold" style={{ color: "var(--leaf-deep)" }}>
                          {c.suggestion}
                        </p>
                        <p className="mt-1 text-xs text-muted">{c.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">好用表达 · Phrases</h2>
                {feedback.phrases.length === 0 ? (
                  <p className="mt-3 text-sm text-muted">继续积累地道表达吧！</p>
                ) : (
                  <ul className="mt-4 space-y-2.5">
                    {feedback.phrases.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-2">
                        <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold text-ink">
                          {p.text}
                        </span>
                        <span className="text-xs text-muted">{p.note}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card flex p-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fff5d8] text-[#cf9612]">
                    <Lightbulb className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="font-display text-lg font-semibold text-ink">Pip 的建议</h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink">{feedback.tip}</p>
                  </div>
                </div>
              </section>
            </div>

            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link to={`/practice/${scenarioId}`}>
                <Button size="lg">
                  <RotateCcw className="h-5 w-5" /> 再来一局
                </Button>
              </Link>
              <Link to="/progress">
                <Button size="lg" variant="soft">
                  查看进度
                </Button>
              </Link>
              <Link to="/">
                <Button size="lg" variant="ghost">
                  回首页
                </Button>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
