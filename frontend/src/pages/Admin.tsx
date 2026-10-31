import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, ArrowRight, Clock3, Database, RefreshCw, Search, ShieldCheck, TriangleAlert, Users, UserRound, X } from "lucide-react";
import { useAuth } from "../store/auth";
import { EChart } from "../components/EChart";
import { referenceCost } from '../lib/adminFormatting';
import { AdminApiError, getAdminOverview, getAdminTrace, getAdminTraces, type AdminFilters, type AdminOverview, type AdminTrace } from "../lib/adminApi";
import "../admin.css";

const defaults: AdminFilters = { hours: 24, source: "server", operation: "", model: "", release: "", outcome: "" };
const labels: Record<string, string> = { ok: "成功", error: "失败", timeout: "超时", cancelled: "已取消" };
const spanLabels: Record<string, string> = { ...labels, incomplete: "未完成" };
const names: Record<string, string> = {
  "POST /api/chat/stream": "场景对话 · 流式回复", "POST /api/chat": "场景对话 · 普通回复",
  "POST /api/interview/score": "Interview · 四题评分", "POST /api/asr": "录音识别",
  "POST /api/asr/session": "直连识别 · 授权", "POST /api/tts/stream": "语音合成 · 流式",
  "POST /api/tts": "语音合成", "asr.finalize": "语音识别 · 收尾等待",
  "asr.transcribe": "录音识别 · 浏览器总耗时", "speech.first_audio": "语音播放 · 首声等待",
  "speech.complete": "语音播放 · 完成（含播放）",
  "speech.playback": "语音播放 · 播放阶段（首声至结束）",
  "speech.voice_resolution": "语音准备 · 最终文本后音色等待",
  "speech.final_text_to_audio": "语音播放 · 最终文本至首声",
  "speech.native_start": "浏览器语音 · 调用至实际开始",
  "speech.cloud_fetch": "云语音 · 完整音频获取",
  "speech.play_start": "音频播放 · play 至 playing",
  "voice.first_audio": "整轮语音 · 检测到说话结束至首声", "voice.complete": "整轮语音 · 完成（含播放）",
};
const ms = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
const number = (n: number | null) => n == null ? "—" : n.toLocaleString("zh-CN");
const date = (s: string) => new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const forbidden = (err: unknown) => err instanceof AdminApiError && (err.status === 401 || err.status === 403);
const dataOperations = new Set(['GET /api/stats', 'GET /api/words', 'GET /api/sessions', 'GET /api/practice', 'GET /api/interview/sets']);
const modelLabel = (trace: AdminTrace) => trace.model ?? (dataOperations.has(trace.operation) ? '数据读取' : '未记录模型');

export default function Admin() {
  const user = useAuth(s => s.user);
  const [filters, setFilters] = useState<AdminFilters>(defaults);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [rows, setRows] = useState<AdminTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [slow, setSlow] = useState(false);
  const [revision, setRevision] = useState(0);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [error, setError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [listError, setListError] = useState("");
  const [denied, setDenied] = useState(false);
  const [detail, setDetail] = useState<AdminTrace | null>(null);
  const [traceLookup, setTraceLookup] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const scopeController = useRef<AbortController | null>(null);
  const previousScope = useRef("");
  const previousList = useRef("");
  const previousRevision = useRef(-1);
  const hasOverview = useRef(false);
  const hasList = useRef(false);
  const canRead = Boolean(user?.is_admin);
  const userId = user?.id;
  const loading = overviewLoading || listLoading;

  useEffect(() => {
    const controller = new AbortController();
    scopeController.current = controller;
    let live = true;
    let blocked = false;
    const scope = JSON.stringify([userId, filters.hours, filters.source, filters.operation, filters.model, filters.release]);
    const listScope = JSON.stringify([scope, filters.outcome, offset, slow]);
    const keepOverview = previousScope.current === scope && hasOverview.current;
    const keepList = previousList.current === listScope && hasList.current;
    const readOverview = !keepOverview || previousRevision.current !== revision;
    previousScope.current = scope; previousList.current = listScope;
    if (!keepOverview || !canRead) { setData(null); setUpdatedAt(null); setOverviewError(""); hasOverview.current = false; }
    if (!keepList || !canRead) { setRows([]); setTotal(0); setListError(""); hasList.current = false; }
    setDetail(null); setDetailLoading(false); setError(""); setDenied(false);
    detailController.current?.abort();
    const rejectAccess = () => {
      blocked = true; controller.abort(); detailController.current?.abort();
      setDenied(true); setData(null); setUpdatedAt(null); setRows([]); setTotal(0); setDetail(null);
      hasOverview.current = false; hasList.current = false;
    };
    if (canRead) {
      setOverviewLoading(readOverview); setListLoading(true);
      if (readOverview) void getAdminOverview({ ...filters, outcome: "" }, controller.signal)
        .then(overview => {
          if (!live || blocked || controller.signal.aborted) return;
          // A table action may abort this effect. Keep its refresh pending until
          // success so the next effect cannot silently keep stale metrics.
          previousRevision.current = revision;
          setData(overview); setOverviewError(""); hasOverview.current = true; setUpdatedAt(new Date().toISOString());
        }).catch((err: unknown) => {
          if (!live || controller.signal.aborted) return;
          if (forbidden(err)) rejectAccess();
          else if (!blocked) setOverviewError(keepOverview ? "概览刷新失败，当前显示上次成功加载的数据。" : "概览暂时无法加载，请重试。下方调用列表仍可单独查看。");
        }).finally(() => { if (live) setOverviewLoading(false); });
      void getAdminTraces(filters, offset, slow, controller.signal)
        .then(list => {
          if (!live || blocked || controller.signal.aborted) return;
          setRows(list.items); setTotal(list.total); setListError(""); hasList.current = true;
        }).catch((err: unknown) => {
          if (!live || controller.signal.aborted) return;
          if (forbidden(err)) rejectAccess();
          else if (!blocked) setListError(keepList ? "调用列表刷新失败，当前显示上次成功加载的结果。" : "调用列表暂时无法加载，请重试。上方概览不受影响。");
        }).finally(() => { if (live) setListLoading(false); });
    } else { setOverviewLoading(false); setListLoading(false); }
    return () => { live = false; controller.abort(); detailController.current?.abort(); };
  }, [canRead, userId, filters, offset, slow, revision]);

  const operationOptions = [...new Set([filters.operation, ...(data?.facets?.operations ?? data?.operations ?? [])])].filter(Boolean);
  const update = (patch: Partial<AdminFilters>) => { setOffset(0); setFilters(old => ({ ...old, ...patch })); };
  const chart = useMemo(() => {
    const points = data?.trend ?? [];
    const operations = [...new Set(points.map(p => p.operation))];
    return { color: ["#e8755c", "#378577", "#ad854f", "#8271a1", "#577a97", "#a7757c"],
      tooltip: { trigger: "axis", renderMode: "richText" },
      legend: { type: "scroll", top: 0, left: 18, right: 18, textStyle: { color: "#736257", fontSize: 12 } },
      grid: { left: 58, right: 24, top: 45, bottom: 30 },
      xAxis: { type: "time", splitNumber: 5, axisLabel: { fontSize: 12, hideOverlap: true } },
      yAxis: { type: "value", name: "ms", min: 0, axisLabel: { fontSize: 12 }, splitLine: { lineStyle: { color: "#f0e8df" } } },
      series: operations.map(op => ({ name: names[op] ?? op, type: "line", symbolSize: 6, connectNulls: false,
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
      if (forbidden(err)) {
        scopeController.current?.abort();
        setDenied(true); setData(null); setUpdatedAt(null); setRows([]); setTotal(0); hasOverview.current = false; hasList.current = false;
      } else setError(err instanceof AdminApiError && err.status === 404 ? "未找到该调用，可能已超过保留期。" : "调用详情无法加载，请稍后重试。");
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }

  if (!canRead || denied) return <main className="admin-page admin-locked">
    <ShieldCheck size={34} /><h1>{denied ? "后台访问权限已失效" : "仅管理员可访问运行看板"}</h1>
    <p>{denied ? "请刷新账号权限并确认服务器管理员授权。" : "请使用已授权的管理员账号登录。"}</p>
    {user && <button className="admin-refresh" disabled={refreshingAccount} onClick={async () => {
      setRefreshingAccount(true);
      try { await useAuth.getState().refresh(); if (canRead) setRevision(value => value + 1); }
      finally { setRefreshingAccount(false); }
    }}><RefreshCw size={16} />{refreshingAccount ? "核对中…" : "刷新账号权限"}</button>}
    <Link to="/me">前往个人中心</Link>
  </main>;

  return <main className="admin-page">
    <header className="admin-heading"><div><span className="admin-eyebrow"><ShieldCheck size={14} /> SPOKEN · 仅管理员可见</span>
      <h1>运行看板<span>请求、耗时与模型用量</span></h1></div>
      <div className="admin-heading-actions">{data && <span className={`admin-collection-state ${!data.collection.active ? "" : data.collection.dropped_since_restart || data.collection.write_errors_since_restart ? "degraded" : "enabled"}`}><i />{!data.collection.active ? "采集未启用" : data.collection.dropped_since_restart || data.collection.write_errors_since_restart ? "采集有缺口" : "采集已启用"}</span>}
        <button className="admin-refresh" disabled={loading} onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} className={loading ? "admin-spinning" : undefined} />{loading ? "加载中…" : "刷新数据"}</button>
      </div>
    </header>
    <div className="admin-toolbar">
      <div role="tablist" aria-label="采集来源" className="admin-tabs">{(["server", "browser"] as const).map(source =>
        <button key={source} role="tab" aria-selected={filters.source === source} onClick={() => update({ source, operation: "", model: "", release: "", outcome: "" })}>{source === "server" ? "后端调用" : "浏览器体验"}</button>)}</div>
      <label>时间范围<select value={filters.hours} onChange={e => update({ hours: Number(e.target.value) })}><option value={24}>近 24 小时</option><option value={168}>近 7 天</option><option value={336}>近 14 天</option></select></label>
      <label className="admin-operation">业务操作<select value={filters.operation} onChange={e => update({ operation: e.target.value })}><option value="">所有操作（混合样本）</option>{operationOptions.map(op => <option key={op} value={op}>{names[op] ?? op}</option>)}</select></label>
      <label>{filters.source === "server" ? "模型" : "引擎 / 传输"}<select aria-label="模型或引擎" value={filters.model} onChange={e => update({ model: e.target.value })}><option value="">全部</option>{(data?.facets?.models ?? []).map(m => <option key={m}>{m}</option>)}</select></label>
      <label>发布版本<select value={filters.release} onChange={e => update({ release: e.target.value })}><option value="">全部</option>{(data?.facets?.releases ?? []).map(r => <option key={r} value={r}>{r === "unknown" ? "未提供版本" : r.slice(0, 10)}</option>)}</select></label>
    </div>
    <div className="admin-scope-caption"><span>{filters.operation ? names[filters.operation] ?? filters.operation : "全部业务概览"}{!filters.operation && " · 性能比较请先选同一种操作"}</span><span>{updatedAt ? `概览更新于 ${date(updatedAt)}` : "仅展示已采集的真实记录"}</span></div>
    <p className="admin-perspective">{filters.source === 'server'
      ? '服务端视角：接口收到请求至响应结束，看业务处理、模型调用和错误。'
      : '用户端视角：记录识别收尾、说完至首声、播放完成，包含网络、队列与播放等待。'}</p>
    {error && <p className="admin-notice" role="alert">{error}</p>}
    {overviewError && <p className="admin-notice admin-error-notice" role="alert"><TriangleAlert size={16} /><span>{overviewError}</span><button onClick={() => setRevision(v => v + 1)}>重试</button></p>}
    {overviewLoading && !data && <p className="admin-loading" role="status">正在读取运行概览…</p>}
    {data && <>
      {filters.source === "browser" && <p className="admin-notice">浏览器上报可能缺失或被修改，独立于后端成功率与 Token 计量。朗读任务首声含等待文字与音频准备，不含之前的识别；整轮首声从检测到说话结束起计。</p>}
      {(!data.collection.active || data.collection.dropped_since_restart > 0 || data.collection.write_errors_since_restart > 0) && <p className="admin-notice" role="status">采集存在缺口：本进程启动后丢弃 {data.collection.dropped_since_restart} 条，写入失败 {data.collection.write_errors_since_restart} 次。{!data.collection.active && "采集未启用。"}</p>}
      {data.collection.at_capacity && <p className="admin-notice">此来源已达到 {data.collection.source_budget?.toLocaleString()} 条保留上限，时间窗可能不完整。以下统计基于当前保留记录。</p>}
      {data.visitors?.at_capacity && <p className="admin-notice">访客记录达到 {data.visitors.max_records.toLocaleString()} 条独立保留上限，UV 可能低于实际。</p>}
      {data.visitors && !data.visitors.enabled && <p className="admin-notice">访客采集未启用，已有计数仅代表保留的历史访问。</p>}
      <section className="admin-metrics" aria-label="运行指标">
        <article title="公开页面未登录浏览器去重；仅受时间范围影响。换浏览器或清除站点数据可能重复计数。"><span><Users size={16} />未登录访客 UV</span><strong>{number(data.visitors?.guest_uv ?? null)}</strong><small>按浏览器 · 排除管理员</small></article>
        <article title="公开页面活跃账号去重；同账号多设备合并。登录前后可与游客 UV 重叠，不相加为总人数。"><span><UserRound size={16} />登录活跃用户</span><strong>{number(data.visitors?.registered_active ?? null)}</strong><small>按账号 · 排除管理员</small></article>
        <article><span><Activity size={16} />{filters.source === "server" ? "保留请求数" : "上报样本"}</span><strong>{number(data.count)}</strong><small>保留 {data.collection.retention_days} 天 · {data.collection.cleanup?.active ? '自动清理' : '写入时清理'}</small></article>
        <article><span><ShieldCheck size={16} />{filters.source === "server" ? "请求成功率" : "正常上报样本"}</span><strong>{filters.source === "browser" ? number(data.count - data.errors - data.timeouts - data.cancelled) : data.success_rate == null ? "—" : `${(data.success_rate * 100).toFixed(1)}%`}</strong><small>{filters.source === "server" ? `取消 ${data.cancelled} 次排除` : "端侧自报，独立于后端成功数"}</small></article>
        <article><span><Clock3 size={16} />P95 总耗时</span><strong>{ms(data.latency.p95)}</strong><small>P50 {ms(data.latency.p50)} · P99 {ms(data.latency.p99)}</small></article>
        <article className={data.errors + data.timeouts ? "admin-metric-alert" : ""}><span><TriangleAlert size={16} />失败 / 超时</span><strong>{number(data.errors + data.timeouts)}</strong><div className="admin-issue-actions"><button aria-pressed={filters.outcome === "error"} onClick={() => update({ outcome: "error" })}>失败 {data.errors}</button><button aria-pressed={filters.outcome === "timeout"} onClick={() => update({ outcome: "timeout" })}>超时 {data.timeouts}</button><ArrowRight size={14} /></div></article>
      </section>
      <section className="admin-panels">
        <article className="admin-panel admin-trend"><div className="admin-panel-heading"><h2>耗时趋势</h2><span>每小时 P95 · 按业务分别统计</span></div>
          {data.trend.length ? <EChart height={176} option={chart} /> : <div className="admin-chart-empty"><Clock3 size={23} /><strong>当前筛选还没有耗时样本</strong><span>可调整业务或时间范围；采集到真实请求后展示趋势。</span></div>}
          <div className="admin-status-line"><span>取消 <b>{data.cancelled}</b> 次，单独记录</span><span>各业务耗时独立观察</span></div>
        </article>
        <article className="admin-panel admin-usage"><div className="admin-panel-heading"><h2><Database size={16} />模型与费用</h2>{data.pricing && <code className="admin-model-name">{data.pricing.configured_model}</code>}</div>
          {data.pricing && <details className="admin-price-details"><summary><span>输入 ¥{data.pricing.rates.input_hit[0]}–{data.pricing.rates.input_miss[1]} /百万</span><span>输出 ¥{data.pricing.rates.output.join('–')} /百万</span></summary><div>
            <p>人民币 / 百万 Token。缓存命中输入 ¥{data.pricing.rates.input_hit.join('–')}，未命中输入 ¥{data.pricing.rates.input_miss.join('–')}。各项低/高值对应空闲/高峰。</p>
            <p>高峰为北京时间非节假日的工作日 9–12、14–18 点。费用区间采用全命中空闲价至全未命中高峰价，未考虑赠送额度或折扣。</p>
            <p>{data.pricing.official_version} · 核对 {data.pricing.checked_at} · <a href={data.pricing.source_url} target="_blank" rel="noreferrer">官方价格</a></p>
          </div></details>}
          <dl><div><dt>输入 Token</dt><dd>{number(data.input_tokens)}</dd></div><div><dt>输出 Token</dt><dd>{number(data.output_tokens)}</dd></div><div><dt>模型首文本 P95</dt><dd>{ms(data.ttft.p95)}</dd></div><div><dt>费用参考区间</dt><dd className="admin-cost-value">{referenceCost(data.pricing?.min_cny, data.pricing?.max_cny)}</dd></div></dl>
          <div className="admin-usage-coverage"><span>{data.pricing ? <>计价覆盖 <b>{data.pricing.priced_records} / {data.pricing.model_records}</b></> : <>完整用量 <b>{data.usage_known} / {data.count}</b></>}</span><span>首文本样本 <b>{data.ttft_known ?? 0}</b></span></div>
          <p>{filters.source === "browser" ? "浏览器样本不提供后端模型 TTFT / Token。" : data.pricing && data.pricing.model_records === 0 ? '当前没有模型调用样本。语音费用按所选引擎与讯飞资源包另计。' : `按公开单价重估已知用量，不代表实扣账单；${(data.pricing?.unknown_usage_records ?? 0) + (data.pricing?.unpriced_records ?? 0)} 条调用未完整计价。语音另计。`}</p>
        </article>
      </section>
    </>}
    <section className="admin-panel admin-traces" aria-label="调用记录">
      <div className="admin-panel-heading"><h2>调用记录 <span>{total} 条</span></h2><form className="admin-trace-lookup" onSubmit={event => {
        event.preventDefault(); const id = traceLookup.trim().toLowerCase();
        if (!/^[a-f0-9]{32}$/.test(id)) { setError("请输入 32 位十六进制 Trace ID。"); return; }
        void inspect(id);
      }}><label htmlFor="admin-trace-id"><Search size={15} />Trace ID</label><input id="admin-trace-id" value={traceLookup} onChange={event => setTraceLookup(event.target.value)} maxLength={64} autoComplete="off" spellCheck={false} placeholder="粘贴调用编号，直达详情" title="输入响应头 X-Trace-Id 中的 32 位调用编号" /><button disabled={detailLoading} type="submit">{detailLoading ? "查找中…" : "查找调用"}</button></form><div className="admin-table-controls">
        <label><input type="checkbox" checked={slow} onChange={e => { setOffset(0); setSlow(e.target.checked); }} />优先查看慢请求</label>
        <select aria-label="调用状态" value={filters.outcome} onChange={e => update({ outcome: e.target.value })}><option value="">全部状态</option>{Object.entries(labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      </div></div>
      {listError && <p className="admin-notice admin-error-notice" role="alert"><TriangleAlert size={16} /><span>{listError}</span><button onClick={() => setRevision(v => v + 1)}>重试</button></p>}
      <div className="admin-table-wrap" aria-busy={listLoading}><table><thead><tr><th>时间 · 北京</th><th>业务操作</th><th>状态</th><th>耗时</th><th>模型 / 引擎</th><th>费用参考</th><th>Trace</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.trace_id} data-outcome={row.outcome}><td><time dateTime={row.started_at}>{date(row.started_at)}</time></td><td className="admin-operation-cell"><strong>{names[row.operation] ?? row.operation}</strong><small>版本 {row.release === "unknown" ? "未提供" : row.release.slice(0, 10)}</small></td><td><span className={`admin-badge ${row.outcome}`}>{labels[row.outcome] ?? row.outcome}</span></td><td className="admin-duration">{ms(row.duration_ms)}</td><td>{modelLabel(row)}</td><td className="admin-row-cost" title="按已采集用量与公开单价参考；未计价不代表零费用">{referenceCost(row.cost_min_cny, row.cost_max_cny)}</td><td><button aria-label={`查看调用 ${row.trace_id.slice(0, 8)}`} onClick={() => void inspect(row.trace_id)}>{row.trace_id.slice(0, 8)} <ArrowRight size={14} /></button></td></tr>)}
        {!rows.length && <tr><td colSpan={7} className="admin-empty">{listLoading ? "正在读取调用记录…" : listError ? "列表读取失败，可点击上方重试。" : "暂无调用记录。可切换业务操作、状态或时间范围；这里不会生成演示数据。"}</td></tr>}
      </tbody></table></div>
      <div className="admin-pagination"><span>{listLoading ? "列表更新中 · " : ""}第 {total ? offset + 1 : 0}–{Math.min(offset + rows.length, total)} 条 / {total} · 状态筛选仅影响列表</span><div><button aria-label="上一页" disabled={listLoading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}><ArrowLeft size={15} /></button><button aria-label="下一页" disabled={listLoading || offset + 50 >= total} onClick={() => setOffset(v => v + 50)}><ArrowRight size={15} /></button></div></div>
    </section>
    {data && <footer className="admin-footnote"><ShieldCheck size={13} /><div>UTC 记录 · 北京时间展示 · 保留策略 {data.collection.retention_days} 天 / {data.collection.max_records.toLocaleString()} 条 · {data.collection.oldest_at ? `最早保留 ${date(data.collection.oldest_at)}` : "暂无保留数据"}
      {data.collection.cleanup?.active && <p>启动、每 {data.collection.cleanup.interval_seconds / 3600} 小时及写入时自动清理；实例休眠后在下次启动补清理。上次成功 {data.collection.cleanup.last_success_at ? date(data.collection.cleanup.last_success_at) : '尚未完成'}。{data.collection.cleanup.failures_since_restart > 0 && `本进程清理失败 ${data.collection.cleanup.failures_since_restart} 次。`}</p>}
      <p>访客仅受时间范围影响，{data.visitors?.started_at ? `自 ${date(data.visitors.started_at)} 开始采集` : '尚未开始采集'}；浏览器与账号口径可重叠，未采集历史无法补算。分位数基于保留样本，历史失败保留供追踪。</p></div></footer>}
    {detail && <TraceDetail detail={detail} onInspect={id => void inspect(id)} onClose={() => { detailController.current?.abort(); setDetail(null); }} />}
  </main>;
}

function TraceDetail({ detail, onInspect, onClose }: { detail: AdminTrace; onInspect: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const failed = detail.outcome === "error" || detail.outcome === "timeout";
  return <aside className="admin-detail" aria-label="调用详情"><header><div><span className="admin-eyebrow">调用详情</span><h2>{names[detail.operation] ?? detail.operation}</h2></div><button aria-label="关闭调用详情" onClick={onClose}><X size={20} /></button></header>
    <div className="admin-detail-status"><span className={`admin-badge ${detail.outcome}`}>{labels[detail.outcome] ?? detail.outcome}</span><time dateTime={detail.started_at}>{date(detail.started_at)}</time></div>
    <code className="admin-trace-id">{detail.trace_id}</code>
    <div className="admin-trace-root"><div><span>总耗时</span><strong>{ms(detail.duration_ms)}</strong></div><div><span>模型 / 引擎</span><b>{modelLabel(detail)}</b></div></div>
    <p className="admin-detail-cost">费用参考：{referenceCost(detail.cost_min_cny, detail.cost_max_cny)}<small>依据当前公开价与已知用量区间，未计价不代表零费用。</small></p>
    <dl className="admin-detail-meta"><div><dt>采集来源</dt><dd>{detail.source === "browser" ? "浏览器上报" : "后端请求"}</dd></div><div><dt>响应</dt><dd>{detail.source === "browser" ? "不适用 HTTP 状态" : detail.http_status == null ? "HTTP 状态未采集" : `HTTP ${detail.http_status}`}</dd></div><div><dt>发布版本</dt><dd>{detail.release === "unknown" ? "未提供版本" : detail.release.slice(0, 12)}</dd></div><div><dt>模型首文本</dt><dd>{ms(detail.ttft_ms)}</dd></div></dl>
    {failed && <section className="admin-failure-context"><h3><TriangleAlert size={16} />失败线索</h3>
      {detail.source === "browser" ? <p>此失败由浏览器上报，请结合关联的后端调用排查；上报可能缺失或被修改。</p>
        : detail.error_type ? <><div className="admin-error-types"><code>{detail.error_type}</code>{detail.error_cause_type && <><ArrowRight size={13} /><code>{detail.error_cause_type}</code></>}</div><p>已采集异常类名；可按调用时间和编号核对服务端日志。</p></>
        : detail.http_status != null && detail.http_status >= 400 ? <p>服务返回 HTTP {detail.http_status}，响应中的具体错误内容未留存。</p>
        : <p>此记录未采集异常类型，无法仅凭耗时判断原因；请结合时间和路径核对服务端日志。</p>}
      <small>历史失败保留用于追踪，不代表接口当前仍在报错。</small>
    </section>}
    {!!detail.related?.length && <section className="admin-related"><h3>同一轮交互</h3><p>各端时钟独立，分别查看，不跨端累加。</p>{detail.related.map(row => <button key={row.trace_id} onClick={() => onInspect(row.trace_id)}><span>{names[row.operation] ?? row.operation}<small>{row.source === "browser" ? "浏览器上报" : "后端请求"}</small></span><b>{ms(row.duration_ms)}</b></button>)}</section>}
    <h3 className="admin-waterfall-title">阶段耗时</h3><p className="admin-waterfall-note">以下阶段共享该端的单调时钟，重叠阶段不累加为总耗时。</p>
    <div className="admin-waterfall">{detail.spans?.length ? detail.spans.map(span => <article key={span.id}><div><strong>{span.name}</strong><span>{ms(span.duration_ms)} · {spanLabels[span.outcome] ?? span.outcome}</span></div>
      <div className="admin-span-track"><i className={span.outcome} style={{ marginLeft: `${Math.min(99, span.offset_ms / Math.max(1, detail.duration_ms) * 100)}%`, width: `${Math.max(0.5, Math.min(100, span.duration_ms / Math.max(1, detail.duration_ms) * 100))}%` }} /></div>
      <dl>{Object.entries(span.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
    </article>) : <p className="admin-empty-spans">此请求没有已采集的子阶段，不据此推测等待位置。</p>}</div>
    <p className="admin-detail-note"><ShieldCheck size={13} />仅保留耗时、状态和白名单元数据，不保存用户问答、音频或凭据。</p>
  </aside>;
}
