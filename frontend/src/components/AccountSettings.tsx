import { useEffect, useState, type FormEvent } from "react";
import { deleteAccount, exportAccountData, getAccountCapabilities, requestEmailVerification } from "../lib/api";
import { useAuth } from "../store/auth";

export default function AccountSettings() {
  const user = useAuth(state => state.user);
  const logout = useAuth(state => state.logout);
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof getAccountCapabilities>> | null>(null);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getAccountCapabilities().then(value => { if (active) setCapabilities(value); }).catch(() => {
      if (active) setError("暂时无法加载账号管理，请稍后刷新重试。");
    });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请稍后重试。"); }
    finally { setBusy(false); }
  }

  async function download() {
    const data = await exportAccountData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "spoken-account.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("账号数据已准备下载。");
  }

  function confirmDelete(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await deleteAccount(password);
      logout();
    });
  }

  if (!user) return <p className="learning-notice">登录后可以管理自己的账号和学习数据。</p>;
  return <section className="card space-y-4 p-6" aria-label="账号与数据">
    <h2 className="font-display text-lg font-semibold text-ink">账号与数据</h2>
    <p className="text-sm text-muted">{user.email} · {user.email_verified ? "邮箱已验证" : "邮箱待验证"}</p>
    {capabilities?.email_actions && !user.email_verified && <button className="ui-secondary" type="button" disabled={busy}
      onClick={() => void run(async () => {
        await requestEmailVerification(); setMessage("验证申请已受理，请检查收件箱和垃圾邮件。");
      })}>发送验证邮件</button>}
    {capabilities?.account_data && <>
      <div className="flex flex-wrap gap-2">
        <button className="ui-secondary" type="button" disabled={busy} onClick={() => void run(download)}>导出学习数据</button>
        {!deleting && <button className="ui-secondary" type="button" disabled={busy} onClick={() => setDeleting(true)}>删除账号</button>}
      </div>
      {deleting && <form className="space-y-3" onSubmit={confirmDelete}>
        <p className="text-sm text-ink">删除后，云端账号、对话、练习和收藏将永久移除。需要留档的话，可以先导出数据。</p>
        <label className="block text-sm">当前密码<input className="mt-1 block rounded-xl border border-border bg-surface p-2"
          autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <div className="flex flex-wrap gap-2">
          <button className="ui-secondary" type="button" disabled={busy} onClick={() => { setDeleting(false); setPassword(""); }}>取消</button>
          <button className="ui-primary" type="submit" disabled={busy}>确认永久删除</button>
        </div>
      </form>}
    </>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {error && <p role="alert" className="text-sm text-coral-deep">{error}</p>}
  </section>;
}
