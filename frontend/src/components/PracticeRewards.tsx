import { useEffect, useRef, useState } from "react";
import { CalendarCheck, Coins, Download, Gift, Target } from "lucide-react";
import wallpaper from "../assets/cafe-hero-1672.webp";
import { ApiError, request } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { rewardDetails, rewardsPath as path, updateEquipment, type RewardItem } from "../lib/rewards";
import { PracticeRewardCatalog, type CatalogItem, type RewardAchievement } from "./PracticeRewardCatalog";
import "./PracticeRewards.css";

interface Wallet {
  date: string;
  coins: number;
  streak: number;
  checked_in: boolean;
  goal_count: number;
  goal_target: number;
  goal_claimed: boolean;
  wallpaper_unlocked: boolean;
  checkin_coins: number;
  goal_coins: number;
  wallpaper_price: number;
  items: CatalogItem[];
  equipment: RewardItem[];
  achievements: RewardAchievement[];
  weekly?: WeeklyRewards;
}

type Action = "checkin" | "goal" | "wallpaper";
type WeeklyGoal = "practice-days" | "review-expressions";
interface WeeklyRewards {
  starts_on: string;
  ends_on: string;
  goals: { id: WeeklyGoal; count: number; target: number; coins: number; claimed: boolean }[];
}
const weeklyLabels: Record<WeeklyGoal, string> = { "practice-days": "练习满 3 天", "review-expressions": "复习 5 条不同表达" };
const shortDay = (value: string) => value.slice(5).replace("-", "/");

export function PracticeRewards({ practiceCount }: { practiceCount?: number }) {
  const [generation, setGeneration] = useState(getAuthGeneration);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const claimRequest = useRef<AbortController | null>(null);
  const version = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeAuthGeneration(() => {
      claimRequest.current?.abort();
      claimRequest.current = null;
      setWallet(null);
      setPending(false);
      setError("");
      setNotice("");
      setGeneration(getAuthGeneration());
    });
    return () => {
      unsubscribe();
      claimRequest.current?.abort();
      claimRequest.current = null;
    };
  }, []);

  useEffect(() => {
    let read: AbortController | undefined;
    function load() {
      if (claimRequest.current) return;
      read?.abort();
      const controller = new AbortController();
      read = controller;
      const started = ++version.current;
      const isCurrent = () => !controller.signal.aborted && generation === getAuthGeneration() && started === version.current;
      void request<Wallet>(path, { signal: controller.signal }).then(data => {
        if (isCurrent()) { setWallet(data); setError(""); updateEquipment(data.equipment ?? [], generation); }
      }).catch(() => {
        if (isCurrent()) setError("暂时无法读取签到奖励。");
      });
    }
    load();
    window.addEventListener("focus", load);
    return () => {
      read?.abort();
      window.removeEventListener("focus", load);
    };
  }, [generation, practiceCount, refresh]);

  function claim(action: Action) {
    if (!wallet) return;
    const notice = action === "wallpaper" ? "Pip 咖啡馆壁纸已解锁。" : "已领取金币。";
    void changeWallet(`${path}/${action}?expected_day=${wallet.date}`, { method: "POST" }, notice);
  }

  async function changeWallet(url: string, init: RequestInit, message: string) {
    if (!wallet || claimRequest.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    claimRequest.current = controller;
    version.current++;
    const isCurrent = () => !controller.signal.aborted && generation === getAuthGeneration();
    setPending(true);
    setError("");
    setNotice("");
    try {
      const data = await request<Wallet>(url, { ...init, signal: controller.signal });
      if (isCurrent()) {
        setWallet(data);
        setNotice(message);
        updateEquipment(data.equipment ?? [], generation);
      }
    } catch (failure) {
      if (isCurrent()) {
        if (failure instanceof ApiError && failure.status === 409) {
          try {
            const data = await request<Wallet>(path, { signal: controller.signal });
            if (isCurrent()) { setWallet(data); updateEquipment(data.equipment ?? [], generation); }
          } catch { /* The next refresh can recover the wallet. */ }
        }
        if (isCurrent()) setError(failure instanceof ApiError && failure.status === 409 ? failure.message : "这次操作未确认，点击重试即可。");
      }
    } finally {
      if (claimRequest.current === controller) claimRequest.current = null;
      if (isCurrent()) setPending(false);
    }
  }

  return <section className="practice-rewards" aria-labelledby="practice-rewards-title">
    <div className="practice-rewards-heading">
      <h3 id="practice-rewards-title"><CalendarCheck aria-hidden="true" />每日签到</h3>
      {wallet && <span><Coins aria-hidden="true" />{wallet.coins} 金币</span>}
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
      <details className="practice-rewards-shop">
        <summary><Gift aria-hidden="true" />奖励与纪念章</summary>
        {wallet.weekly && <WeeklyChallenges weekly={wallet.weekly} pending={pending} claim={goal => {
          const week = wallet.weekly?.starts_on;
          if (week) void changeWallet(`${path}/weekly/${goal}?week_start=${week}`, { method: "POST" }, "已领取本周挑战金币。");
        }} />}
        <PracticeRewardCatalog items={wallet.items ?? []} equipment={wallet.equipment ?? []} achievements={wallet.achievements ?? []}
          coins={wallet.coins} busy={pending}
          redeem={item => void changeWallet(`${path}/items/${item}`, { method: "POST" }, `已兑换${rewardDetails[item].name}。`)}
          equip={(item, equipped) => void changeWallet(`${path}/items/${item}`, {
            method: "PUT", body: JSON.stringify({ equipped }),
          }, `${rewardDetails[item].name}已${equipped ? "启用" : "停用"}。`)} />
        <div className="practice-rewards-item">
          <img src={wallpaper} alt="Pip 坐在咖啡馆桌边" loading="lazy" width="84" height="47" />
          <div><strong>Pip 咖啡馆壁纸</strong>
          {wallet.wallpaper_unlocked ? <a className="ui-link" href={wallpaper} download="spoken-pip-cafe.webp"><Download aria-hidden="true" />下载壁纸</a>
            : <button type="button" className="ui-secondary" disabled={wallet.coins < wallet.wallpaper_price || pending} onClick={() => claim("wallpaper")}>
              {wallet.coins < wallet.wallpaper_price ? `还差 ${wallet.wallpaper_price - wallet.coins} 金币` : `${wallet.wallpaper_price} 金币兑换`}
            </button>}</div>
        </div>
      </details>
    </> : !error && <p role="status">正在读取签到奖励…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}{!wallet && <button type="button" className="ui-link" onClick={() => setRefresh(value => value + 1)}>重试</button>}</p>}
  </section>;
}

function WeeklyChallenges({ weekly, pending, claim }: { weekly: WeeklyRewards; pending: boolean; claim: (goal: WeeklyGoal) => void }) {
  return <section className="practice-weekly-challenges" aria-labelledby="practice-weekly-title">
    <h4 id="practice-weekly-title"><Target aria-hidden="true" />本周挑战</h4>
    <p>{shortDay(weekly.starts_on)}–{shortDay(weekly.ends_on)} · 北京时间 · 周日截止</p>
    <ul>{weekly.goals.map(goal => <li key={goal.id}>
      <div><strong>{weeklyLabels[goal.id]}</strong><span>{goal.count}/{goal.target}</span></div>
      <progress value={goal.count} max={goal.target} aria-label={weeklyLabels[goal.id]} />
      <button type="button" className="ui-secondary" disabled={pending || goal.claimed || goal.count < goal.target}
        aria-label={`${weeklyLabels[goal.id]} · ${goal.claimed ? "已领取" : `领 ${goal.coins} 金币`}`} onClick={() => claim(goal.id)}>
        {goal.claimed ? "本周已领" : goal.count < goal.target ? `达标奖励 ${goal.coins} 金币` : `领 ${goal.coins} 金币`}
      </button>
    </li>)}</ul>
  </section>;
}
