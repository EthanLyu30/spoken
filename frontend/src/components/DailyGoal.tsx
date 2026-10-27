import { useEffect, useState } from "react";
import { ArrowRight, Target } from "lucide-react";
import { Link } from "react-router-dom";
import { getStats, type Stats } from "../lib/api";
import { useAuth } from "../store/auth";

export function DailyGoal() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const owner = useAuth((s) => s.user?.id);
  useEffect(() => {
    const ctrl = new AbortController();
    setStats(null); setError(false);
    getStats(ctrl.signal).then((s) => { if (!ctrl.signal.aborted) setStats(s); }).catch(() => { if (!ctrl.signal.aborted) setError(true); });
    return () => ctrl.abort();
  }, [owner, attempt]);
  const goal = stats?.today_goal ?? 3;
  return <aside className="daily-goal"><div className="goal-heading"><h2><Target />今日目标</h2><strong><span>{stats?.today_count ?? "—"}</span> / {goal} 次</strong></div>
    <div className="goal-track" aria-label={stats ? `今日已完成 ${stats.today_count} 次，目标 ${goal} 次` : "正在读取今日目标"}>{Array.from({ length: Math.min(goal, 10) }, (_, i) => <span key={i} className={stats && i < stats.today_count ? "done" : ""} />)}</div>
    <p>{error ? <>目标暂时无法读取。<button type="button" onClick={() => setAttempt((n) => n + 1)}>重新读取</button></> : stats && stats.today_count >= goal ? "今天的目标已完成，继续保持开口的习惯。" : `完成 ${goal} 次练习，让表达更自然。`}</p>
    <Link to="/progress" className="ui-link">查看学习进度<ArrowRight /></Link>
  </aside>;
}
