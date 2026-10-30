import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, ArrowRight, Clock3, Database, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useAuth } from "../store/auth";
import { EChart } from "../components/EChart";
import { AdminApiError, getAdminOverview, getAdminTrace, getAdminTraces, type AdminFilters, type AdminOverview, type AdminTrace } from "../lib/adminApi";
import "../admin.css";

const defaults: AdminFilters = { hours: 24, source: "server", operation: "POST /api/chat/stream", model: "", release: "", outcome: "" };
const labels: Record<string, string> = { ok: "成功", error: "失败", timeout: "超时", cancelled: "已取消" };
const spanLabels: Record<string, string> = { ...labels, incomplete: "未完成" };
const names: Record<string, string> = {
  "POST /api/chat/stream": "场景对话 · 流式回复", "POST /api/chat": "场景对话 · 普通回复",
  "POST /api/interview/score": "Interview · 四题评分", "POST /api/asr": "录音识别",
  "POST /api/asr/session": "直连识别 · 授权", "POST /api/tts/stream": "语音合成 · 流式",
  "POST /api/tts": "语音合成", "asr.finalize": "语音识别 · 收尾等待",
  "asr.transcribe": "录音识别 · 浏览器总耗时", "speech.first_audio": "语音队列 · 首声等待",
  "speech.complete": "语音队列 · 完成（含播放）",
  "voice.first_audio": "整轮语音 · 检测到说话结束至首声",
  "voice.complete": "整轮语音 · 完成（含播放）",
};
const ms = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
const number = (n: number | null) => n == null ? "—" : n.toLocaleString("zh-CN");
const date = (s: string) => new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function Admin() {
  const user = useAuth(s => s.user);
  const [filters, setFilters] = useState<AdminFilters>(defaults);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [rows, setRows] = useState<AdminTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [slow, setSlow] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [detail, setDetail] = useState<AdminTrace | null>(null);
  const [traceLookup, setTraceLookup] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const canRead = Boolean(user?.is_admin);
  const userId = user?.id;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setData(null); setRows([]); setTotal(0); setDetail(null); setDetailLoading(false); setError(""); setDenied(false);
    detailController.current?.abort();
    if (canRead) {
      setLoading(true);
      Promise.all([getAdminOverview(filters, controller.signal), getAdminTraces(filters, offset, slow, controller.signal)])
        .then(([overview, list]) => { if (live) { setData(overview); setRows(list.items); setTotal(list.total); } })
        .catch((err: unknown) => {
          if (!live || controller.signal.aborted) return;
          if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) setDenied(true);
          else setError("运行数据暂时无法加载，请稍后刷新。");
        }).finally(() => { if (live) setLoading(false); });
    } else setLoading(false);
    return () => { live = false; controller.abort(); detailController.current?.abort(); };
  }, [canRead, userId, filters, offset, slow, revision]);

  const options = data?.facets?.operations ?? data?.operations ?? [];
  const operationOptions = [...new Set([filters.operation, ...options])].filter(Boolean);
  const update = (patch: Partial<AdminFilters>) => { setOffset(0); setFilters(old => ({ ...old, ...patch })); };
  const chart = useMemo(() => {
    const points = data?.trend ?? [];
    const operations = [...new Set(points.map(p => p.operation))];
    return { color: ["#f86b55", "#3f8c83", "#bc9368", "#8870a6"],
      tooltip: { trigger: "axis", renderMode: "richText" },
      grid: { left: 52, right: 20, top: 20, bottom: 34 },
      xAxis: { type: "time" }, yAxis: { type: "value", name: "ms", min: 0 },
      series: operations.map(op => ({ name: names[op] ?? op, type: "line", showSymbol: true, connectNulls: false,
        data: points.filter(p => p.operation === op).map(p => [p.time, p.p95]) })) };
  }, [data]);

  async function inspect(id: string) {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setDetail(null); setDetailLoading(true); setError("");
    try {
      const next = await getAdminTrace(id, controller.signal);
      if (!controller.signal.aborted) setDetail(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) {
        setDenied(true); setData(null); setRows([]);
      } else setError(err instanceof AdminApiError && err.status === 404 ? "未找到该调用，可能已超过保留期。" : "调用详情无法加载，请稍后重试。");
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }

  if (!canRead || denied) return <main className="admin-page admin-locked">
    <ShieldCheck size={34} /><h1>{denied ? "后台访问权限已失效" : "仅管理员可访问运行看板"}</h1>
    <p>{denied ? "请重新登录并确认服务器管理员授权。" : "请使用已授权的管理员账号登录。"}</p><Link to="/me">前往个人中心</Link>
  </main>;

  return <main className="admin-page">
    <header className="admin-heading"><div><span className="admin-eyebrow"><ShieldCheck size={14} /> PRIVATE WORKSPACE</span>
      <h1>运行看板<span>Spoken / Observability</span></h1><p>先看变化，再沿调用链找到等待发生的位置。</p></div>
      <button className="admin-refresh" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} />{loading ? "加载中…" : "刷新数据"}</button>
    </header>
    <div className="admin-toolbar">
      <div role="tablist" aria-label="采集来源" className="admin-tabs">{(["server", "browser"] as const).map(source =>
        <button key={source} role="tab" aria-selected={filters.source === source} onClick={() => update({ source, operation: source === "server" ? defaults.operation : "voice.first_audio", model: "", release: "", outcome: "" })}>{source === "server" ? "后端调用" : "浏览器体验"}</button>)}</div>
      <label>时间范围<select value={filters.hours} onChange={e => update({ hours: Number(e.target.value) })}><option value={24}>近 24 小时</option><option value={168}>近 7 天</option><option value={336}>近 14 天</option></select></label>
      <label className="admin-operation">业务操作<select value={filters.operation} onChange={e => update({ operation: e.target.value })}><option value="">所有操作（混合样本）</option>{operationOptions.map(op => <option key={op} value={op}>{names[op] ?? op}</option>)}</select></label>
      <label>{filters.source === "server" ? "模型" : "引擎 / 传输"}<select aria-label="模型或引擎" value={filters.model} onChange={e => update({ model: e.target.value })}><option value="">全部</option>{(data?.facets?.models ?? []).map(m => <option key={m}>{m}</option>)}</select></label>
      <label>发布版本<select value={filters.release} onChange={e => update({ release: e.target.value })}><option value="">全部</option>{(data?.facets?.releases ?? []).map(r => <option key={r} value={r}>{r === "unknown" ? "未提供版本" : r.slice(0, 10)}</option>)}</select></label>
    </div>
    <form className="admin-trace-lookup" onSubmit={event => {
      event.preventDefault();
      const id = traceLookup.trim().toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(id)) { setError("请输入 32 位十六进制 Trace ID。"); return; }
      void inspect(id);
    }}><label htmlFor="admin-trace-id">Trace ID</label>
      <input id="admin-trace-id" value={traceLookup} onChange={event => setTraceLookup(event.target.value)} maxLength={64} autoComplete="off" spellCheck={false} placeholder="粘贴 32 位调用编号" />
      <button disabled={detailLoading} type="submit">{detailLoading ? "查找中…" : "查找调用"}</button><span>可直接查找响应头中的 X-Trace-Id</span>
    </form>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    {loading && <p className="admin-loading" role="status">正在读取运行数据…</p>}
    {data && <>
      {filters.source === "browser" && <p className="admin-notice">浏览器上报的体验样本，可能缺失或被修改；独立于后端成功率与 Token 计量。首声等待从语音队列创建开始，不含之前的识别。</p>}
      {!filters.operation && <p className="admin-notice">当前为不同业务的混合样本。判断性能变化前，请先选择同一种业务操作。</p>}
      {(!data.collection.active || data.collection.dropped_since_restart > 0 || data.collection.write_errors_since_restart > 0) && <p className="admin-notice" role="status">采集存在缺口：本进程启动后丢弃 {data.collection.dropped_since_restart} 条，写入失败 {data.collection.write_errors_since_restart} 次。{!data.collection.active && "采集未启用。"}</p>}
      {data.collection.at_capacity && <p className="admin-notice">此来源已达到 {data.collection.source_budget?.toLocaleString()} 条保留上限，时间窗可能不完整。以下统计基于当前保留的记录。</p>}
      <section className="admin-metrics" aria-label="运行指标">
        <article><span><Activity size={16} />{filters.source === "server" ? "保留请求数" : "上报样本"}</span><strong>{number(data.count)}</strong><small>{names[filters.operation] ?? "当前筛选范围"}</small></article>
        <article><span><ShieldCheck size={16} />{filters.source === "server" ? "请求成功率" : "异常上报样本"}</span><strong>{filters.source === "browser" ? number(data.errors + data.timeouts) : data.success_rate == null ? "—" : `${(data.success_rate * 100).toFixed(1)}%`}</strong><small>{filters.source === "server" ? "4xx/5xx及流中断不算成功，取消排除" : "仅已上报的失败与超时，不代表全量"}</small></article>
        <article><span><Clock3 size={16} />P95 总耗时</span><strong>{ms(data.latency.p95)}</strong><small>P50 {ms(data.latency.p50)} · P99 {ms(data.latency.p99)}</small></article>
        <article><span><Clock3 size={16} />模型首文本 P95</span><strong>{ms(data.ttft.p95)}</strong><small>{filters.source === "browser" ? "浏览器样本不提供模型 TTFT" : `仅统计流式非空文本 · ${data.ttft_known ?? 0} 个样本`}</small></article>
      </section>
      <section className="admin-panels">
        <article className="admin-panel admin-trend"><div className="admin-panel-heading"><h2>耗时趋势 <span>P95 / 按业务分别统计</span></h2><span>每小时</span></div>
          {data.trend.length ? <EChart height={244} option={chart} /> : <div className="admin-chart-empty">采集到请求后，会在这里显示耗时趋势。</div>}
          <div className="admin-status-line"><span>失败 <b>{data.errors}</b></span><span>超时 <b>{data.timeouts}</b></span><span>取消 <b>{data.cancelled}</b></span></div>
        </article>
        <article className="admin-panel admin-usage"><div className="admin-panel-heading"><h2><Database size={16} /> 模型用量</h2><span>供应商 usage</span></div>
          <dl><div><dt>输入 Token</dt><dd>{number(data.input_tokens)}</dd></div><div><dt>输出 Token</dt><dd>{number(data.output_tokens)}</dd></div><div><dt>完整用量记录</dt><dd>{data.usage_known} / {data.count}</dd></div></dl>
          <p>仅汇总有完整用量返回的请求；缺失不按零计算。费用尚无已配置计价依据。</p>
        </article>
      </section>
      <section className="admin-panel admin-traces" aria-label="调用记录">
        <div className="admin-panel-heading"><h2>调用记录 <span>{total} 条保留记录</span></h2><div className="admin-table-controls">
          <label><input type="checkbox" checked={slow} onChange={e => { setOffset(0); setSlow(e.target.checked); }} />优先查看慢请求</label>
          <select aria-label="调用状态" value={filters.outcome} onChange={e => update({ outcome: e.target.value })}><option value="">全部状态</option>{Object.entries(labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
        </div></div>
        <div className="admin-table-wrap"><table><thead><tr><th>时间 · 北京</th><th>业务操作</th><th>状态</th><th>耗时</th><th>模型 / 引擎</th><th>Trace</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.trace_id}><td>{date(row.started_at)}</td><td>{names[row.operation] ?? row.operation}</td><td><span className={`admin-badge ${row.outcome}`}>{labels[row.outcome] ?? row.outcome}</span></td><td className="admin-duration">{ms(row.duration_ms)}</td><td>{row.model ?? "—"}</td><td><button aria-label={`查看调用 ${row.trace_id.slice(0, 8)}`} onClick={() => void inspect(row.trace_id)}>{row.trace_id.slice(0, 8)} <ArrowRight size={13} /></button></td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="admin-empty">暂无调用记录。可切换业务操作或时间范围；这里不会生成演示数据。</td></tr>}
        </tbody></table></div>
        <div className="admin-pagination"><span>第 {total ? offset + 1 : 0}–{Math.min(offset + rows.length, total)} 条 / {total}</span><div><button aria-label="上一页" disabled={offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}><ArrowLeft size={15} /></button><button aria-label="下一页" disabled={offset + 50 >= total} onClick={() => setOffset(v => v + 50)}><ArrowRight size={15} /></button></div></div>
      </section>
      <footer className="admin-footnote">UTC 记录 · 北京时间展示 · 最多保留 {data.collection.retention_days} 天 / {data.collection.max_records.toLocaleString()} 条 · {data.collection.oldest_at ? `最早保留 ${date(data.collection.oldest_at)}` : "暂无保留数据"} · 分位数为样本统计，少量请求时仅供观察。</footer>
    </>}
    {detail && <aside className="admin-detail" aria-label="调用详情"><header><div><span className="admin-eyebrow">TRACE DETAIL</span><h2>{names[detail.operation] ?? detail.operation}</h2></div><button aria-label="关闭调用详情" onClick={() => { detailController.current?.abort(); setDetail(null); }}><X size={20} /></button></header>
      <code className="admin-trace-id">{detail.trace_id}</code><p>{date(detail.started_at)} · <b>{labels[detail.outcome] ?? detail.outcome}</b> · {detail.source === "browser" ? "浏览器上报" : `HTTP ${detail.http_status ?? "—"}`}</p>
      {!!detail.related?.length && <section className="admin-related"><h3>同一轮交互</h3><p>按匿名交互编号关联。各端时钟独立，分别查看，不跨端累加。</p>{detail.related.map(row => <button key={row.trace_id} onClick={() => void inspect(row.trace_id)}><span>{names[row.operation] ?? row.operation}<small>{row.source === "browser" ? "浏览器上报" : "后端请求"}</small></span><b>{ms(row.duration_ms)}</b></button>)}</section>}
      <div className="admin-trace-root"><strong>总耗时 {ms(detail.duration_ms)}</strong><span>{detail.model ?? "无模型计量"}</span></div>
      <p className="admin-waterfall-note">以下阶段共享该端的单调时钟，重叠阶段不累加为总耗时。</p>
      <div className="admin-waterfall">{detail.spans?.length ? detail.spans.map(span => <article key={span.id}><div><strong>{span.name}</strong><span>{ms(span.duration_ms)} · {spanLabels[span.outcome] ?? span.outcome}</span></div>
        <div className="admin-span-track"><i className={span.outcome} style={{ marginLeft: `${Math.min(99, span.offset_ms / Math.max(1, detail.duration_ms) * 100)}%`, width: `${Math.max(0.5, Math.min(100, span.duration_ms / Math.max(1, detail.duration_ms) * 100))}%` }} /></div>
        <dl>{Object.entries(span.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
      </article>) : <p>此请求没有已采集的子阶段。</p>}</div>
      <p className="admin-detail-note">仅保留耗时、状态和白名单元数据，不保存用户问答、音频或凭据。</p>
    </aside>}
  </main>;
}
