import { NavLink } from "react-router-dom";
import { BookOpen, Home, Quote, TrendingUp, User } from "lucide-react";
import { cn } from "../lib/utils";

const items = [
  { to: "/", icon: Home, label: "首页", end: true },
  { to: "/daily", icon: Quote, label: "金句", end: false },
  { to: "/words", icon: BookOpen, label: "生词本", end: false },
  { to: "/progress", icon: TrendingUp, label: "进度", end: false },
  { to: "/me", icon: User, label: "我的", end: false },
];

/** Fixed bottom tab bar shown on the main pages. */
export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-[0_-8px_24px_-18px_rgba(120,72,40,0.5)]">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2 py-1.5">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 text-xs font-bold transition-colors",
                isActive ? "text-coral" : "text-muted hover:text-ink",
              )
            }
          >
            <it.icon className="h-5 w-5" />
            {it.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
