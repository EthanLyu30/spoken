import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Coins, Download, Volume2 } from "lucide-react";
import { Link } from "react-router-dom";
import shelf from "../assets/shop/display-shelf.webp";
import scarf from "../assets/shop/scarf-pip.webp";
import bell from "../assets/shop/cafe-bell.webp";
import rain from "../assets/shop/rain-window.webp";
import wallpaper from "../assets/cafe-hero-1672.webp";
import { playCafeChime, rewardDetails, type RewardItem } from "../lib/rewards";
import type { RewardWallet } from "../hooks/useRewardWallet";
import { RewardAvatar } from "./RewardAvatar";

const products = [
  { id: "pip-scarf", image: scarf }, { id: "cafe-chime", image: bell }, { id: "cafe-rain", image: rain },
] as const;
const views = ["store", "owned"] as const;
type CatalogView = typeof views[number];

interface Props {
  wallet: RewardWallet | null;
  busy: boolean;
  notice: string;
  redeem: (id: RewardItem) => void;
  equip: (id: RewardItem, enabled: boolean) => void;
  unlockWallpaper: () => void;
}

export function PracticeRewardCatalog({ wallet, busy, notice, redeem, equip, unlockWallpaper }: Props) {
  const [view, setView] = useState<CatalogView>("store");
  const [selection, setSelection] = useState<RewardItem>("pip-scarf");
  const [soundError, setSoundError] = useState(false);
  const group = useId();
  const tabRefs = useRef<Partial<Record<CatalogView, HTMLButtonElement | null>>>({});
  const stock = (id: RewardItem) => wallet?.items?.find(item => item.id === id);
  const visible = view === "store" ? products : products.filter(item => stock(item.id)?.owned);
  const selected = visible.find(item => item.id === selection) ?? visible[0];
  const current = selected && stock(selected.id);
  const active = !!selected && !!wallet?.equipment?.includes(selected.id);
  const showWallpaper = !!wallet && (view === "store" || wallet.wallpaper_unlocked);
  const shortfall = wallet && current ? Math.max(0, current.price - wallet.coins) : 0;
  let purchaseLabel = wallet ? "暂不可兑换" : "等待读取余额";
  if (current) purchaseLabel = shortfall > 0 ? `还差 ${shortfall} 金币` : `${current.price} 金币兑换`;

  function switchView(next: CatalogView) {
    setView(next);
    setSoundError(false);
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = event.key === "Home" ? "store" : event.key === "End" ? "owned"
      : ["ArrowLeft", "ArrowRight"].includes(event.key) ? (view === "store" ? "owned" : "store") : null;
    if (!next) return;
    event.preventDefault();
    switchView(next);
    tabRefs.current[next]?.focus();
  }

  return <>
    <div className="shop-tabs" role="tablist" aria-label="装扮范围">
      {views.map(value => <button key={value} type="button" role="tab" id={`${group}-${value}`}
        ref={element => { tabRefs.current[value] = element; }} aria-controls={`${group}-panel`}
        aria-selected={view === value} tabIndex={view === value ? 0 : -1} onKeyDown={tabKey} onClick={() => switchView(value)}>
        {value === "store" ? "商店" : "已拥有"}
      </button>)}
    </div>
    <div role="tabpanel" id={`${group}-panel`} aria-labelledby={`${group}-${view}`}>
      {view === "store" && <div className="shop-shelf-art">
        <img src={shelf} width={1158} height={451} alt="木质货架上从左到右摆着格纹围巾 Pip、黄铜门铃和拱形雨窗" />
        {products.map(item => <label key={item.id} className={`shop-shelf-hit hit-${item.id}`} aria-hidden="true"
          title={rewardDetails[item.id].name} htmlFor={`${group}-${item.id}`} />)}
      </div>}
      {visible.length > 0 && <fieldset className={view === "store" ? "shop-picks" : "shop-inventory"}>
        <legend className="sr-only">选择装扮</legend>
        {visible.map(item => {
          const data = stock(item.id);
          const equipped = wallet?.equipment?.includes(item.id);
          return <label key={item.id} className="shop-pick" data-selected={item.id === selected?.id}>
            <input name={`${group}-item`} id={`${group}-${item.id}`} type="radio" aria-label={rewardDetails[item.id].name}
              checked={item.id === selected?.id} onChange={() => { setSelection(item.id); setSoundError(false); }} />
            {view === "owned" && <img className="shop-inventory-image" src={item.image} width={112} height={112} alt="" />}
            <span className="shop-pick-name">{rewardDetails[item.id].name}</span>
            <span className="shop-pick-price">{equipped ? "使用中" : data?.owned ? "已拥有" : data ? <><Coins aria-hidden="true" />{data.price} 金币</> : "—"}</span>
          </label>;
        })}
      </fieldset>}
      {view === "owned" && wallet && !visible.length && !wallet.wallpaper_unlocked && <div className="shop-empty">
        <p>还没有已兑换的装扮</p><button type="button" className="ui-link" onClick={() => switchView("store")}>去商店挑选</button>
      </div>}
      {selected && <section className="shop-detail" aria-label="所选装扮">
        <figure className="shop-detail-preview">
          {selected.id === "pip-scarf" ? <RewardAvatar size={92} /> : <img src={selected.image} width={92} height={92} alt="" />}
          <figcaption>{selected.id === "pip-scarf" ? "头像预览" : selected.id === "cafe-chime" ? "音效预览" : "场景预览"}</figcaption>
        </figure>
        <div className="shop-detail-title"><h2>{rewardDetails[selected.id].name}</h2>
          {selected.id === "cafe-chime" && <button type="button" className="ui-link" onClick={async () => setSoundError(!(await playCafeChime()))}>
            <Volume2 size={16} aria-hidden="true" />试听门铃</button>}
          {selected.id === "cafe-rain" && (active ? <Link className="ui-link" to="/prepare/cafe">去咖啡馆看雨</Link> : <p>用于咖啡馆场景预习</p>)}
        </div>
        <div className="shop-detail-actions">
          {current?.owned ? <button type="button" className={active ? "shop-action shop-action-equipped" : "shop-action"} disabled={busy}
            aria-label={`${active ? "停用" : "使用"}${rewardDetails[selected.id].name}`} onClick={() => equip(selected.id, !active)}>
            {active ? "使用中 · 停用" : "立即使用"}</button>
            : <button type="button" className="shop-action" disabled={busy || !current || shortfall > 0}
              aria-label={current && `${current.price} 金币兑换${rewardDetails[selected.id].name}`} onClick={() => redeem(selected.id)}>
              {purchaseLabel}
            </button>}
        </div>
        {soundError && <p role="alert" className="shop-inline-message">当前设备未能播放提示音。</p>}
      </section>}
      <p role="status" className="shop-notice">{notice}</p>
      {showWallpaper && <div className="shop-wallpaper">
        <img src={wallpaper} alt="" width={100} height={56} loading="lazy" />
        <div><strong>Pip 咖啡馆壁纸</strong><small>{wallet.wallpaper_unlocked ? "已拥有" : `${wallet.wallpaper_price} 金币`}</small></div>
        {wallet.wallpaper_unlocked ? <a className="ui-link" href={wallpaper} download="spoken-pip-cafe.webp"><Download size={16} aria-hidden="true" />下载壁纸</a>
          : <button type="button" className="ui-secondary" aria-label={`${wallet.wallpaper_price} 金币兑换Pip 咖啡馆壁纸`}
            disabled={busy || wallet.coins < wallet.wallpaper_price} onClick={unlockWallpaper}>
            {wallet.coins < wallet.wallpaper_price ? `还差 ${wallet.wallpaper_price - wallet.coins} 金币` : "兑换壁纸"}</button>}
      </div>}
    </div>
  </>;
}
