import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { Ring } from "../components/ui/Ring";
import { ProgressBar } from "../components/ui/ProgressBar";
import { getSession, type SessionDetail } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { cn } from "../lib/utils";

const SCORE_COLORS = ["#ff6f5e", "#ff9f45", "#41c08c", "#57b7e8"];

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

function formatTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function SessionView() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const num = Number(id);
    if (!num) {
      setStatus("error");
      return;
    }
    const ctrl = new AbortController();
    getSession(num, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) {
          setDetail(d);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus("error");
      });
    return () => ctrl.abort();
  }, [id]);

  const scenario = detail?.scenario_id ? getScenario(detail.scenario_id) : undefined;
  const sceneLabel = scenario
    ? `${scenario.titleZh} · ${scenario.title}`
    : detail?.scenario_id === "custom"
      ? "自定义场景"
      : (detail?.scenario_id ?? "");

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground celebrate={status === "ready"} />

      <header className="mx-auto w-full max-w-3xl px-5 pt-6">
        <Link to="/progress" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 返回进度
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        {status === "loading" && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="mt-3 text-muted">正在加载这次练习…</p>
          </section>
        )}

        {status === "error" && (
          <section className="card grid place-items-center gap-3 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p role="alert" className="font-semibold text-ink">没找到这次记录，或后端未连接。</p>
            <Link to="/progress">
              <Button variant="soft">返回进度</Button>
            </Link>
          </section>
        )}

        {status === "ready" && detail && (
          <>
            <section className="relative overflow-hidden rounded-huge border border-border bg-surface p-6 shadow-pop md:p-8">
              <div className="grid items-center gap-6 md:grid-cols-[auto_1fr_auto]">
                <Buddy mood="cheer" size={112} className="mx-auto" />
                <div className="text-center md:text-left">
                  <p className="eyebrow">课后小结 · Debrief{sceneLabel ? ` · ${sceneLabel}` : ""}</p>
                  <h1 className="mt-1 font-display text-xl font-semibold leading-snug text-ink md:text-2xl">
                    {detail.summary || "这次练习的小结"}
                  </h1>
                  <p className="mt-2 text-xs text-muted">{formatTime(detail.created_at)}</p>
                </div>
                <Ring pct={detail.overall} size={104} stroke={11} color="var(--coral)">
                  <div className="text-center">
                    <div className="font-display text-2xl font-bold tabnum text-ink">{detail.overall}</div>
                    <div className="text-[0.58rem] font-bold uppercase text-muted">总分</div>
                  </div>
                </Ring>
              </div>
            </section>

            {detail.scores.length > 0 && (
              <section className="card mt-6 p-6">
                <h2 className="font-display text-lg font-semibold text-ink">能力拆解 · Skills</h2>
                <div className="mt-4 space-y-4">
                  {detail.scores.map((s, i) => (
                    <div key={s.key}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className="font-semibold text-ink">
                          {s.label_zh} · {s.label_en}
                        </span>
                        <span className="font-bold tabnum" style={{ color: SCORE_COLORS[i % SCORE_COLORS.length] }}>
                          {s.score}
                        </span>
                      </div>
                      <ProgressBar value={s.score} color={SCORE_COLORS[i % SCORE_COLORS.length]} height={10} />
                    </div>
                  ))}
                </div>
              </section>
            )}

            {detail.tip && (
              <section className="card mt-6 p-6">
                <h2 className="font-display text-lg font-semibold text-ink">Pip 的建议</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink">{detail.tip}</p>
              </section>
            )}

            <section className="card mt-6 p-6">
              <h2 className="mb-3 font-display text-lg font-semibold text-ink">对话回顾 · 你的回答历程</h2>
              {detail.messages.length === 0 ? (
                <p className="text-sm text-muted">这次没有保存对话内容。</p>
              ) : (
                <div className="space-y-2.5">
                  {detail.messages.map((m, i) => {
                    const isPip = m.role === "assistant";
                    return (
                      <div key={i} className={cn("flex", isPip ? "justify-start" : "justify-end")}>
                        <div
                          className={cn(
                            "max-w-[82%] rounded-3xl px-4 py-2.5 text-sm shadow-soft",
                            isPip ? "rounded-tl-md bg-surface-2 text-ink" : "rounded-tr-md text-primary-fg",
                          )}
                          style={isPip ? undefined : { background: "var(--coral)" }}
                        >
                          <p className="text-[0.6rem] font-bold uppercase tracking-wide opacity-70">
                            {isPip ? "Pip" : "You"}
                          </p>
                          <p className="mt-0.5 leading-snug">{m.content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="mt-7 flex justify-center">
              <Link to="/progress">
                <Button variant="soft">返回进度</Button>
              </Link>
            </div>
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
