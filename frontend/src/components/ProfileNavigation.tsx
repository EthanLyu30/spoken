import { Award, History, MessageCircle, Shield, SlidersHorizontal, Store, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import { shopHref } from "../lib/rewards";

export function ProfileNavigation({ active, signedIn }: { active: "profile" | "voice" | "account" | "shop"; signedIn: boolean }) {
  const entries = [
    { to: "/me", label: "资料与成就", icon: UserRound, tab: "profile" },
    { to: "/me?tab=voice", label: "语音设置", icon: SlidersHorizontal, tab: "voice" },
    { to: "/me#practice-history", label: "练习记录", icon: History },
    { to: shopHref, label: "装扮商店", icon: Store, tab: "shop" },
    { to: "/me#badges", label: "成就徽章", icon: Award },
    ...(signedIn ? [{ to: "/me?tab=account", label: "账号与数据", icon: Shield, tab: "account" }] : []),
    { to: "/feedback?from=profile", label: "意见反馈", icon: MessageCircle },
  ];
  return <nav className="profile-tabs profile-navigation" aria-label="个人中心设置">
    {entries.map(({ to, label, icon: Icon, tab }) => <Link key={to} to={to}
      className={active === tab ? "active" : undefined} aria-current={active === tab ? "page" : undefined}>
      <Icon size={18} aria-hidden="true" />{label}
    </Link>)}
  </nav>;
}
