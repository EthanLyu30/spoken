import { CalendarCheck, ChevronRight, Coins, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { useRewardWallet } from "../hooks/useRewardWallet";
import { shopHref } from "../lib/rewards";
import "./PracticeRewards.css";

export function PracticeRewards({ practiceCount }: { practiceCount?: number }) {
  const { wallet, pending, notice, error, refresh, change } = useRewardWallet(practiceCount);
  const weeklyReady = wallet?.weekly?.goals.some(goal => !goal.claimed && goal.count >= goal.target);
  function claim(action: "checkin" | "goal") {
    if (wallet) void change(`/${action}?expected_day=${wallet.date}`, { method: "POST" }, "已领取金币。");
  }

  return <section className="practice-rewards" aria-labelledby="practice-rewards-title">
    <div className="practice-rewards-heading">
      <h3 id="practice-rewards-title"><CalendarCheck aria-hidden="true" />每日签到</h3>
      <Link to={shopHref} className="home-shop-link">
        {wallet ? <span><Coins aria-hidden="true" />{wallet.coins} 金币</span> : <Store aria-hidden="true" />}
        逛商店<ChevronRight aria-hidden="true" />
      </Link>
    </div>
    {wallet ? <>
      <p className="practice-rewards-streak">连续签到 <strong>{wallet.streak}</strong> 天 <small>北京时间</small></p>
      <div className="practice-rewards-actions">
        <button type="button" className="ui-secondary" disabled={wallet.checked_in || pending} onClick={() => claim("checkin")}>
          {wallet.checked_in ? "今日已签到" : `签到 +${wallet.checkin_coins} 金币`}
        </button>
        <button type="button" className="ui-secondary" disabled={wallet.goal_claimed || wallet.goal_count < wallet.goal_target || pending} onClick={() => claim("goal")}>
          {wallet.goal_claimed ? "今日目标已领奖" : wallet.goal_count < wallet.goal_target
            ? `练习 ${wallet.goal_count}/${wallet.goal_target} · 奖 ${wallet.goal_coins} 金币` : `领目标奖 +${wallet.goal_coins} 金币`}
        </button>
      </div>
      {wallet.weekly && <Link className="home-weekly-link" to={`${shopHref}#weekly-challenges`}>
        本周挑战{weeklyReady && " · 可领奖"}<ChevronRight aria-hidden="true" />
      </Link>}
    </> : !error && <p role="status">正在读取签到奖励…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void refresh()}>重新读取</button></p>}
  </section>;
}
