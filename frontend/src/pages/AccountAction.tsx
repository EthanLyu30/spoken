import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { confirmAccountEmailAction } from "../lib/api";
import { useAuth } from "../store/auth";

export default function AccountAction() {
  const [credentials] = useState(() => {
    const fields = new URLSearchParams(window.location.hash.slice(1));
    return { action: fields.get("action"), token: fields.get("token") };
  });
  const refresh = useAuth(state => state.refresh);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const reset = credentials.action === "reset";
  const valid = (reset || credentials.action === "verify") && /^[A-Za-z0-9_-]{43}$/.test(credentials.token ?? "");

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy || !credentials.token) return;
    setBusy(true); setError("");
    try {
      await confirmAccountEmailAction(reset ? "reset" : "verify", credentials.token, reset ? password : undefined);
      setPassword(""); setDone(true);
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法完成操作，请稍后重试。");
    } finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-xl px-5 py-12">
    <section className="card space-y-5 p-6">
      <h1 className="font-display text-xl font-bold text-ink">{reset ? "重置密码" : "验证邮箱"}</h1>
      {!valid ? <p role="alert">链接无效，请从 Spoken 重新申请邮件。</p> : done ?
        <p role="status">{reset ? "密码已重置，请使用新密码登录。" : "邮箱已验证。"}</p> :
        <form className="space-y-4" onSubmit={submit}>
          {reset && <label className="block text-sm">新密码（至少 8 位）<input autoComplete="new-password" type="password"
            className="mt-1 block w-full rounded-xl border border-border bg-surface p-2"
            required minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>}
          {error && <p role="alert" className="text-coral-deep">{error}</p>}
          <button className="ui-primary" disabled={busy} type="submit">{busy ? "处理中…" : reset ? "设置新密码" : "确认验证"}</button>
        </form>}
      <Link className="ui-link" to="/me">返回个人中心</Link>
    </section>
  </main>;
}
