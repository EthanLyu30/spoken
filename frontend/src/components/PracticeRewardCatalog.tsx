import { useState } from "react";
import { Bell, CloudRain, Compass, Medal } from "lucide-react";
import { Link } from "react-router-dom";
import cafe from "../assets/prep/cafe-counter.webp";
import { playCafeChime, rewardDetails, type RewardItem } from "../lib/rewards";
import { RewardAvatar } from "./RewardAvatar";

export interface CatalogItem { id: RewardItem; price: number; owned: boolean }
export interface RewardAchievement { id: "seven-days" | "five-scenes"; count: number; target: number; earned: boolean }
const milestones = {
  "seven-days": { name: "七日开口", description: "累计 7 天完成练习", Icon: Medal },
  "five-scenes": { name: "场景探索者", description: "完成 5 个不同的内置场景", Icon: Compass },
};

export function PracticeRewardCatalog({ items, equipment, achievements, coins, busy, redeem, equip }: {
  items: CatalogItem[]; equipment: RewardItem[]; achievements: RewardAchievement[]; coins: number; busy: boolean;
  redeem: (item: RewardItem) => void; equip: (item: RewardItem, enabled: boolean) => void;
}) {
  const [soundError, setSoundError] = useState(false);
  return <>
    <ul className="practice-rewards-catalog">{items.map(({ id, price, owned }) => {
      const item = rewardDetails[id];
      const active = equipment.includes(id);
      return <li key={id}>
        <div className={`practice-reward-preview reward-preview-${id}`}>
          {id === "pip-scarf" && <RewardAvatar size={47} />}
          {id === "cafe-chime" && <Bell aria-hidden="true" />}
          {id === "cafe-rain" && <><img src={cafe} alt="" loading="lazy" /><CloudRain aria-hidden="true" /></>}
        </div>
        <div className="practice-reward-description">
          <strong>{item.name}</strong>
          <p>{item.description}</p>
          <div className="practice-reward-controls">
            {owned ? <button type="button" className="ui-secondary" disabled={busy} aria-pressed={active}
              aria-label={`${active ? "停用" : "使用"}${item.name}`} onClick={() => equip(id, !active)}>
              {active ? "已启用 · 停用" : "立即使用"}</button>
              : <button type="button" className="ui-secondary" disabled={busy || coins < price}
                aria-label={`${price} 金币兑换${item.name}`} onClick={() => redeem(id)}>
                {coins < price ? `还差 ${price - coins} 金币` : `${price} 金币兑换`}</button>}
            {id === "cafe-chime" && <button type="button" className="ui-link"
              onClick={async () => setSoundError(!(await playCafeChime()))}>试听门铃</button>}
            {id === "cafe-rain" && active && <Link className="ui-link" to="/prepare/cafe">去看看</Link>}
          </div>
        </div>
      </li>;
    })}</ul>
    {soundError && <p role="alert">当前设备未能播放提示音。</p>}
    <section className="practice-achievements" aria-labelledby="practice-achievements-title">
      <h4 id="practice-achievements-title">学习纪念章</h4>
      <ul>{achievements.map(({ id, count, target, earned }) => {
        const { name, description, Icon } = milestones[id];
        return <li key={id} data-earned={earned}>
          <span className="practice-medal"><Icon aria-hidden="true" /></span>
          <div><strong>{name}</strong><p>{description}</p></div>
          <span>{earned ? "已获得" : `${count}/${target}`}</span>
        </li>;
      })}</ul>
    </section>
  </>;
}
