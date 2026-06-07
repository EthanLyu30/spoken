import { useEffect, useState, type FormEvent } from "react";
import { LogIn, LogOut, UserPlus } from "lucide-react";
import { Button } from "./ui/Button";
import { useAuth } from "../store/auth";
import { cn } from "../lib/utils";

const inputCls =
  "w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-ink outline-none focus:border-coral";

/**
 * Account card on the profile page. Logged out: a compact login/register form.
 * Logged in: the account email + a logout button. Accounts are optional — the
 * app keeps working anonymously — so this is purely additive.
 */
export function AuthPanel() {
  const user = useAuth((s) => s.user);
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const logout = useAuth((s) => s.logout);
  const refresh = useAuth((s) => s.refresh);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Validate the persisted token once when the profile opens (clears it if stale).
  useEffect(() => {
    if (user) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user) {
    return (
      <section className="card mt-5 flex items-center justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[0.62rem] font-bold uppercase tracking-wide text-muted">已登录</p>
          <p className="truncate font-display text-lg font-semibold text-ink">{user.email}</p>
          <p className="text-xs text-muted">进度已绑定账号，换设备登录即可续上。</p>
        </div>
        <Button variant="soft" size="sm" onClick={logout} className="shrink-0">
          <LogOut className="h-4 w-4" /> 退出
        </Button>
      </section>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const e2 = email.trim();
      if (mode === "login") await login(e2, password);
      else await register(e2, password);
    } catch (ex) {
      setErr(ex instanceof Error && ex.message ? ex.message : "出错了，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-5 p-5">
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setErr(null);
            }}
            className={cn(
              "rounded-2xl px-3 py-2 text-sm font-bold transition-transform active:translate-y-0.5",
              mode === m
                ? "bg-coral text-primary-fg shadow-pop"
                : "border border-border bg-surface text-ink",
            )}
          >
            {m === "login" ? "登录" : "注册"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-3">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          required
          className={inputCls}
        />
        <input
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 6 位）"
          required
          minLength={6}
          className={inputCls}
        />
        {err && <p className="text-sm font-semibold text-coral-deep">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {mode === "login" ? (
            <>
              <LogIn className="h-4 w-4" /> {busy ? "登录中…" : "登录"}
            </>
          ) : (
            <>
              <UserPlus className="h-4 w-4" /> {busy ? "注册中…" : "注册并绑定进度"}
            </>
          )}
        </Button>
      </form>

      <p className="mt-3 text-xs text-muted">
        {mode === "register"
          ? "注册后，本设备已收藏的生词与练习记录会自动绑定到账号。"
          : "登录后可在任意设备续上你的生词本与进度。"}
      </p>
    </section>
  );
}
