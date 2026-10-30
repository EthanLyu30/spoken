import { useRef, useState } from "react";
import {
  BookOpen,
  Activity,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronDown,
  Home,
  Quote,
  Route,
  UserRound,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";
import { Wordmark } from "./Wordmark";

export function AppHeader() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const user = useAuth((s) => s.user);
  const { pathname } = useLocation();
  return (
    <header className="app-header print:hidden">
      <div className="app-header-inner">
        <Wordmark />
        <nav className="desktop-nav" aria-label="桌面主导航">
          <NavLink to="/" end>
            <Home />
            首页
          </NavLink>
          <NavLink
            to="/scenes"
            className={pathname === "/custom" ? "active" : undefined}
          >
            <Route />
            场景练习
          </NavLink>
          <NavLink to="/interview">
            <BriefcaseBusiness />
            Take an Interview
          </NavLink>
          <div
            className="tools-menu"
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
                trigger.current?.focus();
              }
            }}
          >
            <button
              ref={trigger}
              type="button"
              className={
                pathname === "/words" || pathname === "/daily"
                  ? "active"
                  : undefined
              }
              aria-expanded={open}
              aria-controls="learning-tools"
              onClick={() => setOpen(!open)}
            >
              <BookOpen />
              学习工具
              <ChevronDown className="menu-chevron" />
            </button>
            {open && (
              <div className="nav-dropdown" id="learning-tools">
                <Link to="/words" onClick={() => setOpen(false)}>
                  <BookOpen />
                  生词本
                </Link>
                <Link to="/daily" onClick={() => setOpen(false)}>
                  <Quote />
                  每日金句
                </Link>
              </div>
            )}
          </div>
          <NavLink to="/progress">
            <ChartNoAxesCombined />
            学习进度
          </NavLink>
          {user?.is_admin && <NavLink to="/admin"><Activity />运行后台</NavLink>}
        </nav>
        <Link to="/me" className="account-entry" aria-label="个人中心">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt="" />
          ) : (
            <span className="account-avatar">
              <UserRound />
            </span>
          )}
          <ChevronDown className="menu-chevron" />
        </Link>
      </div>
    </header>
  );
}
