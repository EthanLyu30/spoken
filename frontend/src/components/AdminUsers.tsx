import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Search, Users } from "lucide-react";
import { AdminApiError, getAdminUsers, type AdminUsersPage, type AdminUserSort } from "../lib/adminApi";

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const count = (value?: number | null) => value == null ? "—" : value.toLocaleString("zh-CN");

export function AdminUsers({ revision, onForbidden }: { revision: number; onForbidden: () => void }) {
  const [result, setResult] = useState<{ scope: string; data: AdminUsersPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AdminUserSort>("activity");
  const [offset, setOffset] = useState(0);
  const scope = JSON.stringify([offset, search, sort]);
  const page = result?.scope === scope ? result.data : null;
  const summary = result?.data;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void getAdminUsers({ offset, search, sort }, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.items) || !Number.isInteger(data.total) || !Number.isInteger(data.new_7d)) {
        throw new Error("Account summary is unavailable");
      }
      if (offset > 0 && data.total <= offset) {
        setOffset(Math.max(0, Math.floor((data.total - 1) / 20) * 20));
        return;
      }
      setResult({ scope, data });
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) onForbidden();
      else setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [offset, search, sort, scope, revision, retry, onForbidden]);

  const moveTo = (next: number) => { setLoading(true); setOffset(next); };
  const activation = summary?.activation_24h;
  const activationRate = activation?.eligible ? `${(100 * activation.completed / activation.eligible).toFixed(1)}%` : "—";
  const maturationNote = activation?.eligible
    ? `${activation.completed} / ${activation.eligible} 个账号`
    : summary?.new_7d === 0 ? "近 7 天无新注册，暂无样本" : "新注册账号尚未满 24 小时";
  const items = page?.items ?? [];
  const total = page?.total ?? 0;
  const limit = page?.limit ?? 20;

  return <section aria-label="用户运营">
    <section className="admin-metrics admin-audience" aria-label="用户指标">
      <article><span>注册总人数</span><strong>{count(summary?.registered)}</strong><small>累计普通账号</small></article>
      <article><span>近 7 天新增</span><strong>{count(summary?.new_7d ?? null)}</strong><small>过去 168 小时注册</small></article>
      <article><span>登录活跃账号</span><strong>{count(summary?.visitors?.registered_active)}</strong><small>近 7 天 · 按账号去重</small></article>
      <article><span>未登录访客</span><strong>{count(summary?.visitors?.guest_uv)}</strong><small>近 7 天 · 按浏览器去重</small></article>
    </section>
    <section className="admin-panel admin-activation" aria-label="首练转化">
      <div><h2>注册后 24 小时首练率</h2><p>近 7 天注册且已满 24 小时的普通账号。完成场景会话、跟读或面试任一项计为首练。</p></div>
      <div className="admin-activation-value"><strong>{activationRate}</strong><small>{maturationNote}</small></div>
    </section>
    {summary?.visitors && (!summary.visitors.enabled || summary.visitors.at_capacity) && <p className="admin-notice">
      {summary.visitors.enabled ? "访客记录达到保留上限，显示已保留的访问。" : "访客采集未启用，显示已保留的历史访问。"}
    </p>}
    <section className="admin-panel admin-users" aria-label="注册账号列表" aria-busy={loading}>
      <div className="admin-panel-heading"><h2><Users size={16} />注册账号 <span>{page ? `${count(total)} 人` : ""}</span></h2></div>
      <div className="admin-user-controls">
        <form className="admin-trace-lookup" onSubmit={event => {
          event.preventDefault();
          const next = draft.trim();
          if (next !== search || offset > 0) { moveTo(0); setSearch(next); }
        }}>
          <label htmlFor="admin-user-search"><Search size={15} />搜索账号</label>
          <input id="admin-user-search" value={draft} onChange={event => setDraft(event.target.value)} placeholder="昵称或邮箱" maxLength={255} />
          <button type="submit">搜索</button>
          {search && <button type="button" onClick={() => { setDraft(""); setSearch(""); moveTo(0); }}>清除</button>}
        </form>
        <label className="admin-user-sort">排序<select value={sort} onChange={event => { moveTo(0); setSort(event.target.value as AdminUserSort); }}>
          <option value="activity">最近练习优先</option><option value="registered">最近注册优先</option>
        </select></label>
      </div>
      {error && <div className="admin-notice admin-error-notice" role="alert">
        <span>{page ? "刷新失败，当前显示上次成功的数据。" : "账号列表加载失败。"}</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>重试</button>
      </div>}
      {loading && !page && <p className="admin-loading" role="status">正在读取账号…</p>}
      {page && <><div className="admin-table-wrap" role="region" aria-label="账号表格" tabIndex={0}>
        <table><thead><tr><th scope="col">账号</th><th scope="col">注册时间</th><th scope="col">最近练习</th>
          <th scope="col">场景会话</th><th scope="col">生词</th><th scope="col">跟读 / 面试</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id}>
            <td className="admin-account-cell"><strong>{item.display_name || "未命名"}</strong><small>{item.email}</small></td>
            <td><time dateTime={item.created_at}>{dateTime.format(new Date(item.created_at))}</time></td>
            <td>{item.last_active ? <time dateTime={item.last_active}>{dateTime.format(new Date(item.last_active))}</time> : "暂无练习"}</td>
            <td>{item.sessions}</td><td>{item.words}</td><td>{item.practice}</td>
          </tr>)}
          {!items.length && <tr><td colSpan={6} className="admin-empty">{search ? "没有匹配的账号。" : "暂无普通注册账号。"}</td></tr>}</tbody>
        </table>
      </div>
      <div className="admin-pagination"><span>{loading ? "更新中 · " : ""}{total ? `${offset + 1}–${offset + items.length}` : "0"} / {count(total)} · 北京时间</span>
        <div><button type="button" aria-label="账号上一页" disabled={loading || !offset} onClick={() => moveTo(Math.max(0, offset - limit))}><ArrowLeft size={15} /></button>
          <button type="button" aria-label="账号下一页" disabled={loading || offset + limit >= total} onClick={() => moveTo(offset + limit)}><ArrowRight size={15} /></button></div>
      </div></>}
    </section>
    <p className="admin-audience-note">普通账号统计排除管理员。访客按浏览器去重，与登录活跃账号可能重叠。最近练习包含会话、跟读、面试与复习，数量列反映当前保留的记录。</p>
  </section>;
}
