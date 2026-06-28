import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { EChartsOption } from "echarts";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { EChart } from "../components/EChart";
import {
  getInsights,
  getSession,
  getSessions,
  type Insights,
  type SessionDetail,
  type SessionSummary,
} from "../lib/api";
import { getScenario } from "../data/scenarios";
import { tokens } from "../lib/tokens";
import { cn } from "../lib/utils";

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

type Status = "loading" | "ready" | "error";

export default function Progress() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [latest, setLatest] = useState<SessionDetail | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const ctrl = new AbortController();
    getSessions(ctrl.signal)
      .then(async (list) => {
        if (ctrl.signal.aborted) return;
        setSessions(list);
        if (list.length) {
          try {
            const detail = await getSession(list[0].id, ctrl.signal);
            if (!ctrl.signal.aborted) setLatest(detail);
          } catch {
            /* radar is optional */
          }
        }
        if (!ctrl.signal.aborted) setStatus("ready");
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus("error");
      });
    // Cross-session analysis is a nice-to-have; never block the page on it.
    getInsights(ctrl.signal)
      .then((i) => {
        if (!ctrl.signal.aborted) setInsights(i);
      })
      .catch(() => {
        /* insights optional */
      });
    return () => ctrl.abort();
  }, []);

  const lineOption = useMemo<EChartsOption>(() => {
    const trend = [...sessions].reverse(); // oldest -> newest
    return {
      grid: { left: 38, right: 18, top: 20, bottom: 28 },
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
        max: 100,
        splitLine: { lineStyle: { color: tokens.border } },
        axisLabel: { color: tokens.muted },
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: trend.map((s) => s.overall),
          symbolSize: 8,
          lineStyle: { color: tokens.coral, width: 3 },
          itemStyle: { color: tokens.coral },
          areaStyle: { color: tokens.coral, opacity: 0.14 },
        },
      ],
    };
  }, [sessions]);

  const radarOption = useMemo<EChartsOption | null>(() => {
    if (!latest || latest.scores.length === 0) return null;
    return {
      radar: {
        indicator: latest.scores.map((s) => ({ name: s.label_zh, max: 100 })),
        radius: "62%",
        splitLine: { lineStyle: { color: tokens.border } },
        splitArea: { areaStyle: { color: ["#fffdf9", "#fff6ec"] } },
        axisLine: { lineStyle: { color: tokens.border } },
        axisName: { color: tokens.ink, fontSize: 12 },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: latest.scores.map((s) => s.score),
              areaStyle: { color: tokens.coral, opacity: 0.2 },
              lineStyle: { color: tokens.coral, width: 2 },
              itemStyle: { color: tokens.coral },
            },
          ],
        },
      ],
    };
  }, [latest]);

  return (
    <div className="min-h-screen pb-24">
      <PlayfulBackground />

      <header className="mx-auto w-full max-w-3xl px-5 pt-6">
        <Link to="/" className={backLink}>
          <ArrowLeft className="h-4 w-4" /> 回首页
        </Link>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-6">
        <div className="mb-6">
          <p className="eyebrow">Your progress · 我的进度</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink sm:text-3xl">能力趋势</h1>
        </div>

        {status === "loading" && (
          <section className="card grid place-items-center p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p className="mt-3 text-muted">正在加载你的练习记录…</p>
          </section>
        )}

        {status === "error" && (
          <section className="card grid place-items-center gap-3 p-10 text-center">
            <Buddy mood="idle" size={110} />
            <p role="alert" className="font-semibold text-ink">
              读取记录失败，请确认后端在运行后重试。
            </p>
            <Link to="/">
              <Button variant="soft">回首页</Button>
            </Link>
          </section>
        )}

        {status === "ready" && sessions.length === 0 && (
          <section className="card grid place-items-center gap-2 p-10 text-center">
            <Buddy mood="happy" size={140} />
            <h2 className="mt-2 font-display text-xl font-semibold text-ink">还没有练习记录</h2>
            <p className="text-muted">完成一次对话并查看小结，这里就会出现你的能力趋势。</p>
            <Link to="/" className="mt-3">
              <Button size="lg">去练一段</Button>
            </Link>
          </section>
        )}

        {status === "ready" && sessions.length > 0 && (
          <div className="space-y-6">
            {insights?.available && insights.weakest && (
              <section className="card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-lg font-semibold text-ink">成长洞察</h2>
                    <p className="text-sm text-muted">
                      最近 {insights.sessions} 次练习的能力分析
                    </p>
                  </div>
                  <TrendBadge delta={insights.overall_delta} />
                </div>

                <div className="mt-4 rounded-2xl bg-surface-2 p-4">
                  <p className="text-sm text-muted">最该练的一项</p>
                  <p className="mt-0.5 font-display text-xl font-semibold text-ink">
                    {insights.weakest.label_zh}
                    <span className="ml-2 text-base font-semibold text-muted">
                      均分 {insights.weakest.avg}
                    </span>
                  </p>
                  {insights.strongest && insights.strongest.key !== insights.weakest.key && (
                    <p className="mt-1 text-sm text-muted">
                      最稳的是「{insights.strongest.label_zh}」（{insights.strongest.avg}
                      ），继续保持～
                    </p>
                  )}
                </div>

                <ul className="mt-4 space-y-2.5">
                  {insights.skills.map((s) => (
                    <li key={s.key} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 font-semibold text-ink">{s.label_zh}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${s.avg}%`, background: tokens.coral }}
                        />
                      </span>
                      <span className="tabnum w-8 shrink-0 text-right text-sm text-muted">
                        {s.avg}
                      </span>
                      <TrendBadge delta={s.delta} small />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">总分趋势</h2>
                <p className="text-sm text-muted">最近 {sessions.length} 次练习</p>
                <EChart option={lineOption} height={260} className="mt-2" />
              </section>
              <section className="card p-6">
                <h2 className="font-display text-lg font-semibold text-ink">最近一次能力雷达</h2>
                {radarOption ? (
                  <EChart option={radarOption} height={260} className="mt-2" />
                ) : (
                  <p className="mt-3 text-sm text-muted">最近一次没有能力评分。</p>
                )}
              </section>
            </div>

            <section className="card p-6">
              <h2 className="font-display text-lg font-semibold text-ink">历史记录</h2>
              <p className="text-sm text-muted">点任意一条，回看小结与对话</p>
              <ul className="mt-3 divide-y divide-border">
                {sessions.map((s) => {
                  const sc = getScenario(s.scenario_id);
                  const label = sc
                    ? `${sc.titleZh} · ${sc.title}`
                    : s.scenario_id === "custom"
                      ? "自定义场景"
                      : s.scenario_id;
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/session/${s.id}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{label}</p>
                          <p className="text-xs text-muted">{formatTime(s.created_at)}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span
                            className="rounded-full px-3 py-1 text-sm font-bold tabnum"
                            style={{ background: "#fff5d8", color: "#cf9612" }}
                          >
                            {s.overall}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

/** Coloured pill showing a skill's short-term trend (+/- points). */
function TrendBadge({ delta, small = false }: { delta: number; small?: boolean }) {
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const cls =
    dir === "up"
      ? "bg-[#e6f7ef] text-[#2fa274]"
      : dir === "down"
        ? "bg-[#ffe8e3] text-[#e6503d]"
        : "bg-surface-2 text-muted";
  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  const word = dir === "up" ? "进步" : dir === "down" ? "回落" : "持平";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 font-bold",
        small ? "text-xs" : "text-sm",
        cls,
      )}
      title={`相比更早的练习${word} ${delta === 0 ? "" : sign} 分`}
    >
      <Icon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {small ? (delta === 0 ? "持平" : sign) : `${word} ${delta === 0 ? "" : sign}`}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
