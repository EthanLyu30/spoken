import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { EChartsOption } from "echarts";
import { PlayfulBackground } from "../components/PlayfulBackground";
import { Buddy } from "../components/Buddy";
import { Button } from "../components/ui/Button";
import { EChart } from "../components/EChart";
import {
  getSession,
  getSessions,
  type SessionDetail,
  type SessionSummary,
} from "../lib/api";
import { getScenario } from "../data/scenarios";
import { tokens } from "../lib/tokens";

const backLink =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink shadow-soft transition-transform hover:-translate-y-0.5";

type Status = "loading" | "ready" | "error";

export default function Progress() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [latest, setLatest] = useState<SessionDetail | null>(null);
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
    <div className="min-h-screen">
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
            <p className="font-semibold text-ink">读取记录失败，请确认后端在运行后重试。</p>
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
              <ul className="mt-3 divide-y divide-border">
                {sessions.map((s) => {
                  const sc = getScenario(s.scenario_id);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {sc ? `${sc.titleZh} · ${sc.title}` : s.scenario_id}
                        </p>
                        <p className="text-xs text-muted">{formatTime(s.created_at)}</p>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-3 py-1 text-sm font-bold tabnum"
                        style={{ background: "#fff5d8", color: "#cf9612" }}
                      >
                        {s.overall}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
