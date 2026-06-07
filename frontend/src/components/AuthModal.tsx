import { useState, type FormEvent } from "react";
import { LogIn, UserPlus, X } from "lucide-react";
import { Button } from "./ui/Button";
import { useAuth } from "../store/auth";
import { cn } from "../lib/utils";

const inputCls =
  "w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-ink outline-none focus:border-coral";

/**
 * Login / register dialog opened from the profile hero. Kept as a modal so the
 * account flow lives inside the identity card instead of a separate page module.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const em = email.trim();
      if (mode === "login") await login(em, password);
      else await register(em, password);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error && ex.message ? ex.message : "出错了，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-huge border border-border bg-surface p-6 shadow-pop">
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 text-muted transition-colors hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-display text-xl font-semibold text-ink">
          {mode === "login" ? "登录" : "注册"}
        </h2>
        <p className="mb-4 mt-1 text-sm text-muted">登录后可在任意设备续上你的生词本与进度。</p>

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
            : "还没有账号？切到「注册」即可创建。"}
        </p>
      </div>
    </div>
  );
}
