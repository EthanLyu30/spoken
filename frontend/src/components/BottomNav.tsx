import { NavLink } from "react-router-dom";
import { BookOpen, Home, Route, Timer, TrendingUp, User } from "lucide-react";
import { cn } from "../lib/utils";

const items = [
  { to: "/", icon: Home, label: "首页", end: true },
  { to: "/scenes", icon: Route, label: "场景", end: false },
  { to: "/interview", icon: Timer, label: "访谈", end: false },
  { to: "/words", icon: BookOpen, label: "生词本", end: false },
  { to: "/progress", icon: TrendingUp, label: "进度", end: false },
  { to: "/me", icon: User, label: "我的", end: false },
];

/** Fixed bottom tab bar shown on the main pages. */
export function BottomNav() {
  return (
    <nav
      aria-label="主导航"
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1.5">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[0.7rem] font-bold transition-colors",
                isActive ? "text-coral" : "text-muted hover:text-ink",
              )
            }
          >
            <it.icon className="h-5 w-5 shrink-0" />
            {it.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
