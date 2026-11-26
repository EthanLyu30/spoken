import { useEffect, useRef } from "react";
import { ChevronLeft, Coins, Compass, Medal } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import pip from "../assets/pip-192.webp";
import { BottomNav } from "../components/BottomNav";
import { PracticeRewardCatalog } from "../components/PracticeRewardCatalog";
import { ProfileNavigation } from "../components/ProfileNavigation";
import { RewardAvatar } from "../components/RewardAvatar";
import { useRewardWallet, type WeeklyGoal } from "../hooks/useRewardWallet";
import { rewardDetails, useRewardEquipped } from "../lib/rewards";
import { useAuth } from "../store/auth";
import "./RewardShop.css";

const weeklyLabels: Record<WeeklyGoal, string> = { "practice-days": "练习满 3 天", "review-expressions": "复习 5 条不同表达" };
const milestones = {
  "seven-days": { name: "七日开口", description: "累计 7 天完成练习", Icon: Medal },
  "five-scenes": { name: "场景探索者", description: "完成 5 个不同的内置场景", Icon: Compass },
};
const shortDay = (value: string) => value.slice(5).replace("-", "/");

export default function RewardShop() {
  const { generation, wallet, pending, notice, error, refresh, change } = useRewardWallet();
  const user = useAuth(s => s.user);
  const scarf = useRewardEquipped("pip-scarf");
  const { hash } = useLocation();
  const weekly = wallet?.weekly;
  const weekStart = weekly?.starts_on;
  const challenges = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash === "#weekly-challenges" && weekStart) challenges.current?.scrollIntoView?.({ block: "start" });
  }, [hash, weekStart]);
  useEffect(() => {
    if (!hash && window.scrollY > 0) window.scrollTo(0, 0);
  }, [hash]);

  return <div className="min-h-screen shop-route">
    <main className="reward-shop-page" id="spoken-main" tabIndex={-1}>
      <aside className="shop-sidebar">
        <Link to="/me" className="shop-identity" aria-label="返回我的小屋">
          <ChevronLeft className="shop-back-icon" aria-hidden="true" />
          {scarf ? <RewardAvatar size={94} /> : <img className="shop-identity-image" src={user?.avatar_url || pip} alt="" />}
          <strong>我的小屋</strong>
        </Link>
        <ProfileNavigation active="shop" signedIn={!!user} />
      </aside>
      <div className="shop-content">
        <header className="shop-toolbar">
          <h1>装扮商店</h1>
          <span className="shop-balance" aria-label={wallet ? `余额 ${wallet.coins} 金币` : "正在读取金币余额"}>
            <Coins aria-hidden="true" /><strong>{wallet?.coins ?? "—"}</strong> 金币
          </span>
        </header>
        {error && <p className="shop-error" role="alert">{error} <button type="button" className="ui-link" onClick={() => void refresh()}>重新读取</button></p>}
        {!wallet && !error && <p className="sr-only" role="status">正在读取金币和装扮…</p>}
        <PracticeRewardCatalog key={generation} wallet={wallet} busy={pending} notice={notice}
          redeem={id => void change(`/items/${id}`, { method: "POST" }, `已兑换${rewardDetails[id].name}。`)}
          equip={(id, equipped) => void change(`/items/${id}`, { method: "PUT", body: JSON.stringify({ equipped }) },
            `${rewardDetails[id].name}已${equipped ? "启用" : "停用"}。`)}
          unlockWallpaper={() => { if (wallet) void change(`/wallpaper?expected_day=${wallet.date}`, { method: "POST" }, "Pip 咖啡馆壁纸已解锁。"); }} />
        <div className="shop-learning-rewards">
          {weekly && <section id="weekly-challenges" ref={challenges} className="shop-weekly" aria-labelledby="shop-weekly-title">
            <h2 id="shop-weekly-title">本周挑战</h2>
            <p>{shortDay(weekly.starts_on)}–{shortDay(weekly.ends_on)} · 北京时间 · 周日截止</p>
            <ul>{weekly.goals.map(goal => <li key={goal.id}>
              <div><strong>{weeklyLabels[goal.id]}</strong><span>{goal.count}/{goal.target}</span></div>
              <progress value={goal.count} max={goal.target} aria-label={weeklyLabels[goal.id]} />
              <button type="button" className="ui-secondary" disabled={pending || goal.claimed || goal.count < goal.target}
                aria-label={`${weeklyLabels[goal.id]} · ${goal.claimed ? "已领取" : `领 ${goal.coins} 金币`}`}
                onClick={() => void change(`/weekly/${goal.id}?week_start=${weekly.starts_on}`, { method: "POST" }, "已领取本周挑战金币。")}>{
                  goal.claimed ? "本周已领" : goal.count < goal.target ? `达标奖励 ${goal.coins} 金币` : `领 ${goal.coins} 金币`
                }</button>
            </li>)}</ul>
          </section>}
          {!!wallet?.achievements?.length && <section className="shop-medals" aria-labelledby="shop-medals-title">
            <h2 id="shop-medals-title">学习纪念章</h2>
            <ul>{wallet.achievements.map(badge => {
              const { Icon, name, description } = milestones[badge.id];
              return <li key={badge.id} data-earned={badge.earned}>
                <span className="shop-medal-icon"><Icon aria-hidden="true" /></span>
                <div><strong>{name}</strong><p>{description}</p></div>
                <span>{badge.earned ? "已获得" : `${badge.count}/${badge.target}`}</span>
              </li>;
            })}</ul>
          </section>}
        </div>
      </div>
    </main>
    <BottomNav />
  </div>;
}
