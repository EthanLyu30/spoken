import { useEffect, useState, type FormEvent } from "react";
import { LogIn, UserPlus, X } from "lucide-react";
import { Button } from "./ui/Button";
import { useAuth } from "../store/auth";
import { cn } from "../lib/utils";
import { getAccountCapabilities, requestPasswordReset } from "../lib/api";

const inputCls =
  "w-full rounded-2xl border border-border bg-surface-2 px-4 py-2.5 text-ink outline-none focus:border-coral";

/**
 * Login / register dialog opened from the profile hero. Kept as a modal so the
 * account flow lives inside the identity card instead of a separate page module.
 */
export function AuthModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);

  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void getAccountCapabilities().then(value => { if (active) setCanReset(value.email_actions); }).catch(() => {
      if (active) setCanReset(false);
    });
    return () => { active = false; };
  }, [open]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMessage("");
    try {
      const em = email.trim();
      if (mode === "reset") {
        await requestPasswordReset(em);
        setMessage("如果该邮箱可以重置密码，你将收到邮件。请检查收件箱和垃圾邮件。");
        return;
      }
      if (mode === "login") await login(em, password);
      else await register(em, password);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error && ex.message ? ex.message : "出错了，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "reset" ? "重置密码" : mode === "login" ? "登录" : "注册";

  return (
    <div className="auth-overlay fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={mode === "reset" ? title : `${title}账号`}>
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
          {title}
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
                setMessage("");
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
            aria-label="邮箱"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            required
            className={inputCls}
          />
          {mode !== "reset" && <input
            aria-label="密码"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 6 位）"
            required
            minLength={6}
            className={inputCls}
          />}
          {err && <p role="alert" className="text-sm font-semibold text-coral-deep">{err}</p>}
          {message && <p role="status" className="text-sm text-muted">{message}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {mode === "reset" ? (busy ? "提交中…" : "申请重置邮件") : mode === "login" ? (
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

        {mode === "login" && canReset && <button type="button" className="ui-link mt-3" onClick={() => {
          setMode("reset"); setErr(null); setMessage(""); setPassword("");
        }}>忘记密码？</button>}

        <p className="mt-3 text-xs text-muted">
          {mode === "register"
            ? "注册后，本设备已收藏的生词与练习记录会自动绑定到账号。"
            : "还没有账号？切到「注册」即可创建。"}
        </p>
      </div>
    </div>
  );
}
