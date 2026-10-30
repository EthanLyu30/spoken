import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  Flame,
  Headphones,
  RefreshCw,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import type { EChartsOption } from "echarts";
import { BottomNav } from "../components/BottomNav";
import { Buddy } from "../components/Buddy";
import { InterviewResults } from "../components/InterviewResults";
import { useProgressData } from "../hooks/useProgressData";
import { useAuth } from "../store/auth";
import { getClientId } from "../lib/clientId";
import { getPracticeDetail, type InterviewScore } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { tokens } from "../lib/tokens";
import { interviewProgressSummary } from "../lib/interviewScoring";

const EChart = lazy(() =>
  import("../components/EChart").then((module) => ({ default: module.EChart })),
);
const mean = (values: number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;
function date(iso: string) {
  const value = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : iso + "Z");
  return Number.isNaN(value.getTime())
    ? iso
    : value.toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export default function Progress() {
  const navigate = useNavigate();
  const account = useAuth((s) => s.user?.id);
  const owner = account ? "account:" + account : "device:" + getClientId();
  const data = useProgressData(owner);
  const {
    sessions,
    stats,
    practice,
    insights,
    latest,
    status,
    errors,
    reload,
  } = data;
  const [filter, setFilter] = useState("all");
  const [radarOpen, setRadarOpen] = useState(false);
  const [review, setReview] = useState<{
    owner: string;
    result: InterviewScore;
  } | null>(null);
  const [reviewError, setReviewError] = useState(false);
  const [reviewLoading, setReviewLoading] = useState<number | null>(null);
  const interview = practice.filter((p) => p.kind === "interview");
  const average = mean(sessions.map((s) => s.overall));
  const interviewSummary = interviewProgressSummary(interview);
  const total = stats ? stats.total_sessions + stats.total_practice : null;
  const goal = stats?.today_goal ?? 3;
  const today = stats?.today_count;
  const lineOption = useMemo<EChartsOption>(
    () => ({
      grid: { left: 32, right: 18, top: 20, bottom: 28 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: [...sessions]
          .reverse()
          .map((s) => date(s.created_at).split(" ")[0]),
        axisLabel: { color: tokens.muted, hideOverlap: true, fontSize: 10 },
        axisLine: { lineStyle: { color: tokens.border } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: tokens.border, type: "dashed" } },
        axisLabel: { color: tokens.muted, fontSize: 10 },
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: [...sessions].reverse().map((s) => s.overall),
          symbolSize: 6,
          lineStyle: { color: tokens.coral, width: 3 },
          itemStyle: { color: tokens.coral },
          areaStyle: { color: tokens.coral, opacity: 0.09 },
        },
      ],
    }),
    [sessions],
  );
  const radarOption = useMemo<EChartsOption>(
    () => ({
      radar: {
        indicator:
          latest?.scores.map((s) => ({ name: s.label_zh, max: 100 })) ?? [],
        radius: "60%",
        axisName: { color: tokens.ink, fontSize: 11 },
        splitArea: { areaStyle: { color: ["#fffdf9", "#fcf4eb"] } },
        splitLine: { lineStyle: { color: tokens.border } },
      },
      series: [
        {
          type: "radar",
          data: [
            {
              value: latest?.scores.map((s) => s.score) ?? [],
              areaStyle: { color: tokens.coral, opacity: 0.2 },
              lineStyle: { color: tokens.coral },
            },
          ],
        },
      ],
    }),
    [latest],
  );
  const history = [
    ...sessions.map((s) => ({
      key: "s" + s.id,
      id: s.id,
      kind: "session",
      title:
        getScenario(s.scenario_id)?.titleZh ??
        (s.scenario_id === "custom" ? "自定义场景" : s.scenario_id),
      score: s.overall,
      scale: 100,
      at: s.created_at,
    })),
    ...practice.map((p) => ({
      key: "p" + p.id,
      id: p.id,
      kind: p.kind,
      title:
        p.title || (p.kind === "interview" ? "Take an Interview" : "跟读练习"),
      score: p.score,
      scale: p.kind === "interview" ? (p.score_max === 5 ? 5 : 6) : 100,
      at: p.created_at,
    })),
  ]
    .filter((item) => filter === "all" || item.kind === filter)
    .sort((a, b) => b.at.localeCompare(a.at));
  async function openReview(id: number) {
    setReviewLoading(id);
    setReviewError(false);
    const expectedOwner = owner;
    try {
      const record = await getPracticeDetail(id);
      const detail = JSON.parse(record.detail);
      if (!Array.isArray(detail.results) || !detail.results.length)
        throw new Error("legacy record");
      setReview({ owner: expectedOwner, result: detail });
    } catch {
      setReviewError(true);
    } finally {
      setReviewLoading(null);
    }
  }
  return (
    <div className="min-h-screen pb-24 progress-page">
      <main className="mx-auto">
        <header className="learning-page-heading">
          <div>
            <p className="eyebrow">YOUR LEARNING JOURNEY</p>
            <h1>把每一次开口，连成进步。</h1>
            <p>看见积累，也找到下一步的方向。</p>
          </div>
          <button className="ui-secondary" onClick={reload}>
            <RefreshCw size={15} />
            刷新记录
          </button>
        </header>
        {errors.length > 0 && (
          <div className="learning-notice" role="status">
            部分记录暂时未能更新，已加载的内容仍可查看。
            <button onClick={reload}>重新加载</button>
          </div>
        )}
        <section
          className="learning-overview"
          aria-label="学习概览"
          aria-busy={status === "loading"}
        >
          <Metric
            icon={<BookOpen />}
            label="累计练习"
            value={total}
            suffix="次"
            note={
              stats
                ? stats.total_sessions +
                  " 次场景 · " +
                  stats.total_practice +
                  " 次专项"
                : "正在读取你的积累"
            }
          />
          <Metric
            icon={<ChartNoAxesCombined />}
            label="近期场景均分"
            value={average}
            suffix="/ 100"
            note={
              sessions.length
                ? "最近 " + sessions.length + " 次场景对话"
                : "完成场景对话后点亮"
            }
          />
          <Metric
            icon={<Headphones />}
            label={interviewSummary.scale === 5 ? "近期访谈内容均分" : "旧版访谈均分"}
            value={interviewSummary.average}
            suffix={"/ " + interviewSummary.scale}
            note={
              interviewSummary.count
                ? interviewSummary.scale === 5
                  ? "新版 " + interviewSummary.count + " 次 · 内容参考分" + (interviewSummary.legacyCount ? "；旧版 " + interviewSummary.legacyCount + " 次未混入" : "")
                  : "旧版 " + interviewSummary.count + " 次 · 保留原分制"
                : "从一组主题访谈开始"
            }
          />
          <Metric
            icon={<Flame />}
            label="连续学习"
            value={stats?.streak_days ?? null}
            suffix="天"
            note="保持开口，慢慢成为习惯"
          />
        </section>
        <section className="learning-today">
          <div className="learning-today-icon">
            <Target />
          </div>
          <div>
            <span className="eyebrow">A LITTLE EVERY DAY</span>
            <h2>
              {today !== undefined && today >= goal
                ? "今天的目标，已经完成。"
                : "今天，再给自己一点进步。"}
            </h2>
            <p>
              {stats
                ? "Lv." +
                  stats.level +
                  " · " +
                  stats.xp +
                  " / " +
                  stats.xp_to_next +
                  " XP"
                : "你的每一次练习，都在这里留下痕迹。"}
            </p>
          </div>
          <div className="learning-goal">
            <span>
              今日目标{" "}
              <strong>
                {today ?? "—"} / {goal}
              </strong>
            </span>
            <progress
              max={goal}
              value={Math.min(today ?? 0, goal)}
              aria-label="今日学习目标"
            />
          </div>
          <Link className="ui-button" to="/scenes">
            继续练习
            <ArrowRight size={16} />
          </Link>
        </section>
        <div className="learning-analysis-grid">
          <section className="learning-panel">
            <div className="learning-section-title">
              <div>
                <p className="eyebrow">YOUR MOMENTUM</p>
                <h2>每一次，都比上次更从容。</h2>
              </div>
              <span className="learning-unit">场景对话 · /100</span>
            </div>
            {sessions.length > 0 ? (
              <Suspense
                fallback={
                  <div className="chart-placeholder">正在绘制你的练习趋势…</div>
                }
              >
                <EChart option={lineOption} height={230} />
              </Suspense>
            ) : (
              <div className="learning-chart-empty">
                <ChartNoAxesCombined />
                <p>
                  {status === "loading"
                    ? "正在读取练习记录…"
                    : "第一条曲线，从第一次开口开始。"}
                </p>
                <Link to="/scenes">
                  去选一个熟悉的场景
                  <ArrowRight size={14} />
                </Link>
              </div>
            )}
            <p className="learning-footnote">
              按最近 {sessions.length || "若干"}{" "}
              次场景对话展示；访谈评分单独记录。
            </p>
          </section>
          <section
            className="learning-panel learning-skills"
            id="growth-insights"
          >
            <div className="learning-section-title">
              <div>
                <p className="eyebrow">FIND YOUR NEXT STEP</p>
                <h2>让优势更稳，让表达更自然。</h2>
              </div>
              <TrendingUp size={20} />
            </div>
            {insights?.available ? (
              <>
                <div className="learning-focus">
                  <span>下一步，试着多练</span>
                  <strong>{insights.weakest?.label_zh}</strong>
                  <p>
                    最近 {insights.sessions} 次对话的综合观察 ·{" "}
                    {insights.overall_delta > 0 ? "+" : ""}
                    {insights.overall_delta} 分变化
                  </p>
                </div>
                <div className="learning-skill-list">
                  {insights.skills.map((skill) => (
                    <div key={skill.key}>
                      <span>{skill.label_zh}</span>
                      <progress
                        max={100}
                        value={skill.avg}
                        aria-label={skill.label_zh + " " + skill.avg + "分"}
                      />
                      <strong>{skill.avg}</strong>
                      <small>
                        {skill.delta > 0 ? "+" : ""}
                        {skill.delta}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="learning-skills-empty">
                <Buddy size={68} />
                <p>
                  {!insights && !errors.includes("insights")
                    ? "能力分析会在记录加载后补齐。"
                    : "完成一段场景对话，就能找到值得继续练的一项。"}
                </p>
              </div>
            )}
            {latest?.scores.length ? (
              <details
                onToggle={(event) => setRadarOpen(event.currentTarget.open)}
              >
                <summary>查看最近一次能力雷达</summary>
                {radarOpen && (
                  <Suspense
                    fallback={
                      <div className="chart-placeholder">正在绘制能力雷达…</div>
                    }
                  >
                    <EChart option={radarOption} height={230} />
                  </Suspense>
                )}
              </details>
            ) : null}
          </section>
        </div>
        <section className="learning-history">
          <div className="learning-section-title">
            <div>
              <p className="eyebrow">EVERY CONVERSATION COUNTS</p>
              <h2>回看走过的每一步</h2>
            </div>
            <CalendarDays size={21} />
          </div>
          <div
            className="learning-history-tabs"
            role="group"
            aria-label="筛选练习记录"
          >
            {[
              ["all", "全部练习"],
              ["session", "场景对话"],
              ["interview", "Interview"],
              ["pronunciation", "跟读"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {reviewError && (
            <p role="status" className="learning-notice">
              这条旧记录没有保存逐题详情，或暂时无法读取。其他记录仍可查看。
            </p>
          )}
          {history.length ? (
            <ul>
              {history.map((item) => (
                <li key={item.key}>
                  {item.kind === "session" ? (
                    <Link
                      to={"/session/" + item.id}
                      className="learning-history-row"
                    >
                      <HistoryRow item={item} />
                    </Link>
                  ) : item.kind === "interview" ? (
                    <button
                      className="learning-history-row"
                      onClick={() => void openReview(item.id)}
                      disabled={reviewLoading === item.id}
                    >
                      <HistoryRow item={item} />
                    </button>
                  ) : (
                    <div className="learning-history-row">
                      <HistoryRow item={item} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="learning-history-empty">
              <Buddy size={70} />
              <h3>
                {status === "loading" || data.practicePending
                  ? "正在找回你的练习记录…"
                  : "这里，等你的第一次开口。"}
              </h3>
              <p>场景对话、访谈和跟读练习都会汇集在这里。</p>
              <Link to="/interview" className="ui-link">
                试试一组主题访谈
                <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </section>
        {review?.owner === owner && (
          <ReviewDialog onClose={() => setReview(null)}>
            <InterviewResults
              result={review.result}
              onRestart={() => navigate("/interview")}
              onExit={() => setReview(null)}
              exitLabel="关闭回顾"
            />
          </ReviewDialog>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
function ReviewDialog({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="learning-review-overlay"
      aria-label="访谈历史回顾"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div>
        <button
          className="learning-close"
          aria-label="关闭访谈回顾"
          onClick={onClose}
        >
          <X />
        </button>
        {children}
      </div>
    </dialog>
  );
}
function Metric({
  icon,
  label,
  value,
  suffix,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  suffix: string;
  note: string;
}) {
  return (
    <div className="learning-metric">
      <span className="learning-metric-label">
        {icon}
        {label}
      </span>
      <p>
        <strong>{value ?? "—"}</strong>
        <span>{suffix}</span>
      </p>
      <small>{note}</small>
    </div>
  );
}
function HistoryRow({
  item,
}: {
  item: {
    kind: string;
    title: string;
    at: string;
    score: number;
    scale: number;
  };
}) {
  return (
    <>
      <span className={"learning-history-icon " + item.kind}>
        {item.kind === "interview" ? (
          <Headphones />
        ) : item.kind === "session" ? (
          <BookOpen />
        ) : (
          <Flame />
        )}
      </span>
      <span className="learning-history-copy">
        <strong>{item.title}</strong>
        <small>
          {date(item.at)} ·{" "}
          {item.kind === "interview"
            ? "主题访谈"
            : item.kind === "session"
              ? "场景对话"
              : "跟读练习"}
        </small>
      </span>
      <span className="learning-history-score">
        {item.score}
        <small> / {item.scale}</small>
      </span>
      <ChevronRight size={17} />
    </>
  );
}
