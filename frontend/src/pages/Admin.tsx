import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, ArrowLeft, ArrowRight, Clock3, Database, Mail, RefreshCw, Search, ShieldCheck, TriangleAlert, Users, X } from "lucide-react";
import { useAuth } from "../store/auth";
import { EChart } from "../components/EChart";
import { AdminUsers } from "../components/AdminUsers";
import { AdminFeedbackInbox } from "../components/AdminFeedbackInbox";
import { modelLabel, referenceCost } from '../lib/adminFormatting';
import { AdminApiError, getAdminOverview, getAdminTrace, getAdminTraces, getDeployedBrowserRelease, type AdminAsrReplays, type AdminDelivery, type AdminExperience, type AdminFilters, type AdminOverview, type AdminSampleCoverage, type AdminTrace, type AdminTracePage, type AdminTraffic } from "../lib/adminApi";
import "../admin.css";

const emptyTracePage: AdminTracePage = { items: [], total: 0 };
const defaults: AdminFilters = { hours: 24, source: "server", operation: "", model: "", release: "", outcome: "", traffic: "unmarked", testRunId: "", delivery: "all" };
const knownRelease = (release: string | null) => release && release !== "unknown" ? release : undefined;
type ReleaseMode = "current" | "all" | "history";
const isTestRelease = (release: string) => /^(development|test|qa)([-_]|$)/i.test(release);
const releaseLabel = (release: string) => release === "unknown" ? "未知版本" : isTestRelease(release) ? `测试 · ${release}` : release.slice(0, 10);
const views = [
  { id: "overview", label: "运行概览", icon: Activity },
  { id: "diagnostics", label: "调用诊断", icon: Search },
  { id: "users", label: "用户运营", icon: Users },
  { id: "feedback", label: "意见审核", icon: Mail },
] as const;
const labels: Record<string, string> = { ok: "成功", error: "失败", timeout: "超时", cancelled: "已取消" };
const spanLabels: Record<string, string> = { ...labels, incomplete: "未完成" };
const asrReasonLabels: Record<string, string> = {
  empty: "识别未返回文字。单凭空转写无法判断麦克风输入或供应商的状态。",
  incomplete: "识别只取得部分转写，需确认或重录。",
  timeout: "识别等待超时。此记录由识别期限触发。",
  disconnect: "识别连接断开或网络请求失败。",
  provider_error: "识别供应商返回错误。可用数值错误码核对原因。",
  http_error: "整段录音识别的 HTTP 请求失败。",
  unavailable: "识别通道暂不可用。",
  cancelled: "录音或识别任务已取消。取消动作的触发来源未采集。",
  user_cancelled: "用户点击结束通话，本轮录音识别随之取消。",
  quota_cooldown: "识别额度冷却期间跳过了请求。",
  unknown: "未采集到可分类的识别失败原因。",
};
const measurementLabels: Record<string, string> = {
  asr_reason: "识别结果分类", provider_code: "供应商错误码",
  llm_tcp: "模型 TCP 建连（ms）", llm_tls: "模型 TLS 握手（ms）",
  llm_headers: "等待模型响应头阶段（ms）", llm_response_headers: "模型请求至响应头（ms）",
  llm_first_event: "模型首个非空响应行（ms）", llm_first_text: "模型请求至首字（ms）",
  llm_headers_to_text: "响应头后等待首字（ms）", llm_keepalives_before_text: "首字前保活行数",
};
const names: Record<string, string> = {
  "POST /api/chat/stream": "场景对话 · 流式回复", "POST /api/chat": "场景对话 · 普通回复",
  "POST /api/interview/score": "Interview · 四题评分", "POST /api/asr": "录音识别",
  "POST /api/asr/session": "直连识别 · 授权", "WS /api/asr/stream": "流式识别 · 后端中继",
  "asr.attempt": "语音识别 · 通道尝试", "POST /api/tts/stream": "语音合成 · 流式",
  "POST /api/tts": "语音合成", "asr.finalize": "语音识别 · 收尾等待",
  "POST /api/tts/prepare": "云语音 · 按需预连接",
  "asr.transcribe": "录音识别 · 浏览器总耗时", "speech.first_audio": "语音播放 · 建队列至开始回调",
  "speech.complete": "语音播放 · 完成（含播放）",
  "speech.playback": "语音播放 · 播放阶段（首声至结束）",
  "speech.voice_resolution": "语音准备 · 最终文本后音色等待",
  "speech.final_text_to_audio": "语音播放 · 最终文本至开始回调",
  "speech.native_start": "浏览器语音 · 启动结果回调（非声学测量）",
  "chat.first_text": "对话 · 请求至首段文本",
  "chat.complete": "对话 · 请求至完整文本返回",
  "chat.tail": "对话 · 最后文本至完整返回",
  "speech.request_to_audio": "对话 · 提交至播放开始回调（识别后）",
  "speech.cloud_fetch": "云语音 · 完整音频获取",
  "speech.play_start": "音频播放 · play 至 playing",
  "voice.first_audio": "整轮语音 · 说话结束至播放开始回调", "voice.complete": "整轮语音 · 完成（含播放）",
};
const ms = (n: number | null | undefined) => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
function formatReplayDelay(delay: number | null) {
  if (delay == null || !Number.isFinite(delay) || delay < 0) return "未采集";
  if (delay < 60_000) return ms(delay);
  const seconds = Math.floor(delay / 1000);
  const parts: [number, string][] = [
    [Math.floor(seconds / 3600), "小时"],
    [Math.floor(seconds / 60) % 60, "分"],
    [seconds % 60, "秒"],
  ];
  return parts.filter(([value]) => value > 0).map(([value, unit]) => `${value} ${unit}`).join(" ");
}
const number = (n: number | null) => n == null ? "—" : n.toLocaleString("zh-CN");
const date = (s: string) => new Date(s).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const forbidden = (err: unknown) => err instanceof AdminApiError && (err.status === 401 || err.status === 403);

function TestRunFilter({ value, onApply }: { value: string; onApply: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  return <form className="admin-trace-lookup" onSubmit={event => { event.preventDefault(); onApply(draft.trim()); }}>
    <label htmlFor="admin-test-run-id">测试批次 ID</label>
    <input id="admin-test-run-id" value={draft} onChange={event => setDraft(event.target.value)}
      maxLength={64} autoComplete="off" spellCheck={false} placeholder="留空显示全部测试批次" />
    <button type="submit">筛选批次</button>
  </form>;
}

export default function Admin() {
  const user = useAuth(s => s.user);
  const [params, setParams] = useSearchParams();
  const view = views.find(item => item.id === params.get("view"))?.id ?? "overview";
  const setView = (next: (typeof views)[number]["id"]) => {
    if (next === view) return;
    const updated = new URLSearchParams(params);
    if (next === "overview") updated.delete("view");
    else updated.set("view", next);
    setParams(updated);
  };
  const [overviewFilters, setOverviewFilters] = useState<AdminFilters>(defaults);
  const [diagnosticFilters, setDiagnosticFilters] = useState<AdminFilters>(defaults);
  const [overviewReleaseMode, setOverviewReleaseMode] = useState<ReleaseMode>("current");
  const [diagnosticReleaseMode, setDiagnosticReleaseMode] = useState<ReleaseMode>("current");
  const [serverRelease, setServerRelease] = useState<string | null>(null);
  const [publishedBrowserRelease, setPublishedBrowserRelease] = useState<{ scope: string; release: string } | null>(null);
  const diagnostics = view === "diagnostics";
  const showsCalls = view === "overview" || diagnostics;
  // Overview always keeps its own scope (server source, no business filters).
  // Diagnostics owns its source/operation/model/outcome and its own version.
  const selectedFilters = diagnostics ? diagnosticFilters : overviewFilters;
  const releaseMode = diagnostics ? diagnosticReleaseMode : overviewReleaseMode;
  const setFilters = diagnostics ? setDiagnosticFilters : setOverviewFilters;
  const setReleaseMode = diagnostics ? setDiagnosticReleaseMode : setOverviewReleaseMode;
  const [overviewData, setData] = useState<AdminOverview | null>(null);
  const [trendOpen, setTrendOpen] = useState(false);
  const [tracePage, setTracePage] = useState<AdminTracePage>(emptyTracePage);
  const [offset, setOffset] = useState(0);
  const [slow, setSlow] = useState(false);
  const [revision, setRevision] = useState(0);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [loadingList, setListLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [error, setError] = useState("");
  const [overviewError, setOverviewError] = useState("");
  const [listError, setListError] = useState("");
  const [deniedAccount, setDeniedAccount] = useState<number | null>(null);
  const [detail, setDetail] = useState<AdminTrace | null>(null);
  const [traceLookup, setTraceLookup] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const openFirstFailure = useRef(false);
  const scopeController = useRef<AbortController | null>(null);
  const previousScope = useRef("");
  const previousList = useRef("");
  const previousRevision = useRef(-1);
  const hasOverview = useRef(false);
  const hasList = useRef(false);
  const canRead = Boolean(user?.is_admin);
  const userId = user?.id;
  const denied = deniedAccount !== null && deniedAccount === userId;
  const browserCurrent = diagnostics && selectedFilters.source === "browser" && releaseMode === "current";
  const browserReleaseScope = canRead && !denied && (browserCurrent || (view === "overview" && releaseMode === "current"))
    ? `${userId}:${view}:${revision}` : "";
  const browserRelease = publishedBrowserRelease?.scope === browserReleaseScope ? publishedBrowserRelease.release : null;
  const checkingBrowserRelease = Boolean(browserReleaseScope) && browserRelease === null;
  const data = checkingBrowserRelease ? null : overviewData;
  const { items: rows, total, coverage: listCoverage } = checkingBrowserRelease ? emptyTracePage : tracePage;
  const listLoading = checkingBrowserRelease || loadingList;
  const filters = useMemo(() => browserCurrent
    ? { ...selectedFilters, release: knownRelease(browserRelease) ?? "" }
    : selectedFilters, [browserCurrent, browserRelease, selectedFilters]);
  const sourceRetention = data?.collection.sources?.[filters.source];
  const testBudget = sourceRetention?.test_budget;
  const testRetained = sourceRetention?.test_retained;
  const useListCoverage = diagnostics && (Boolean(filters.outcome) || !data?.coverage);
  const coverage = useListCoverage ? listCoverage : data?.coverage;
  const loading = checkingBrowserRelease || overviewLoading || listLoading;
  useEffect(() => {
    if (!browserReleaseScope) { setPublishedBrowserRelease(null); return; }
    const controller = new AbortController();
    void getDeployedBrowserRelease(controller.signal).catch(() => "unknown").then(release => {
      if (!controller.signal.aborted) setPublishedBrowserRelease({ scope: browserReleaseScope, release });
    });
    return () => controller.abort();
  }, [browserReleaseScope]);
  const rejectAccess = useCallback(() => {
    scopeController.current?.abort();
    detailController.current?.abort();
    setDeniedAccount(userId ?? null);
    setData(null); setUpdatedAt(null); setTracePage(emptyTracePage); setDetail(null);
    hasOverview.current = false; hasList.current = false;
  }, [userId]);
  const inspect = useCallback(async (id: string, trigger?: HTMLElement) => {
    const focused = trigger ?? document.activeElement;
    if (focused instanceof HTMLElement && !focused.closest(".admin-detail")) detailTrigger.current = focused;
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setDetail(null); setDetailLoading(true); setError("");
    try {
      const next = await getAdminTrace(id, controller.signal);
      if (!controller.signal.aborted) setDetail(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (forbidden(err)) rejectAccess();
      else setError(err instanceof AdminApiError && err.status === 404 ? "未找到该调用，可能已超过保留期。" : "调用详情无法加载，请稍后重试。");
    } finally { if (!controller.signal.aborted) setDetailLoading(false); }
  }, [rejectAccess]);
  const closeDetail = useCallback(() => {
    detailController.current?.abort();
    setDetail(null);
    detailTrigger.current?.focus();
    detailTrigger.current = null;
  }, []);

  const EXPERIENCE_ALL = "__all";
  const currentServerRelease = releaseMode === "current"
    ? serverRelease === null ? undefined : serverRelease === "unknown" ? EXPERIENCE_ALL : serverRelease
    : releaseMode === "all" ? undefined : filters.release || undefined;
  const currentBrowserRelease = releaseMode === "current"
    ? browserRelease === "unknown" ? EXPERIENCE_ALL : browserRelease ?? undefined
    : releaseMode === "all" ? undefined : filters.release || undefined;
  useEffect(() => {
    if (checkingBrowserRelease) return;
    const controller = new AbortController();
    scopeController.current = controller;
    let live = true;
    const inspectFirst = openFirstFailure.current;
    openFirstFailure.current = false;
    const scope = JSON.stringify([userId, view, releaseMode, filters.hours, filters.source, filters.operation, filters.model, filters.release, filters.traffic, filters.testRunId, filters.delivery, currentBrowserRelease]);
    const listScope = JSON.stringify([scope, filters.outcome, offset, slow]);
    const keepOverview = previousScope.current === scope && hasOverview.current;
    const keepList = previousList.current === listScope && hasList.current;
    const readOverview = !keepOverview || previousRevision.current !== revision;
    previousScope.current = scope; previousList.current = listScope;
    if (!keepOverview || !canRead) { setData(null); setUpdatedAt(null); setOverviewError(""); hasOverview.current = false; }
    if (!keepList || !canRead) { setTracePage(emptyTracePage); setListError(""); hasList.current = false; }
    setDetail(null); setDetailLoading(false); setError("");
    detailController.current?.abort();
    if (canRead && !denied && showsCalls) {
      setOverviewLoading(readOverview); setListLoading(diagnostics);
      if (readOverview) void getAdminOverview({ ...filters, outcome: "" }, controller.signal, !diagnostics, currentServerRelease, currentBrowserRelease)
        .then(overview => {
          if (!live || controller.signal.aborted) return;
          // A table action may abort this effect. Keep its refresh pending until
          // success so the next effect cannot silently keep stale metrics.
          previousRevision.current = revision;
          setData(overview); setOverviewError(""); hasOverview.current = true; setUpdatedAt(new Date().toISOString());
          const resolved = overview.server_release ?? "unknown";
          setServerRelease(resolved);
          if (releaseMode === "current" && filters.source === "server") {
            // An unknown runtime release must clear a previously known
            // filter; otherwise the notice says "all retained" while the
            // request still filters the old version.
            const nextRelease = resolved === "unknown" ? "" : resolved;
            if (filters.release !== nextRelease) {
              setFilters(old => old.release === nextRelease ? old : { ...old, release: nextRelease });
            }
          }
        }).catch((err: unknown) => {
          if (!live || controller.signal.aborted) return;
          if (forbidden(err)) rejectAccess();
          else setOverviewError(keepOverview ? "概览刷新失败，当前显示上次成功加载的数据。" : "概览暂时无法加载，请重试。调用列表仍可单独查看。");
        }).finally(() => { if (live) setOverviewLoading(false); });
      if (diagnostics) void getAdminTraces(filters, offset, slow, controller.signal)
        .then(list => {
          if (!live || controller.signal.aborted) return;
          setTracePage(list); setListError(""); hasList.current = true;
          if (inspectFirst && list.items[0]) void inspect(list.items[0].trace_id);
        }).catch((err: unknown) => {
          if (!live || controller.signal.aborted) return;
          if (forbidden(err)) rejectAccess();
          else setListError(keepList ? "调用列表刷新失败，当前显示上次成功加载的结果。" : "调用列表暂时无法加载，请重试。上方概览不受影响。");
        }).finally(() => { if (live) setListLoading(false); });
    } else { setOverviewLoading(false); setListLoading(false); }
    return () => { live = false; controller.abort(); detailController.current?.abort(); };
  }, [canRead, denied, diagnostics, userId, view, showsCalls, releaseMode, filters, offset, slow, revision, rejectAccess, inspect, currentServerRelease, currentBrowserRelease, serverRelease, setFilters, checkingBrowserRelease]);

  const operationOptions = [...new Set([filters.operation, ...(data?.facets?.operations ?? data?.operations ?? [])])].filter(Boolean);
  const update = (patch: Partial<AdminFilters>) => { setOffset(0); setFilters(old => ({ ...old, ...patch })); };
  const filterOutcome = (outcome: "error" | "timeout", inspectFirst = false) => {
    openFirstFailure.current = inspectFirst;
    if (diagnostics) {
      // Inside diagnostics keep the current source and business operation; only
      // change the status filter and return to the first page.
      setOffset(0);
      setDiagnosticFilters(old => ({ ...old, outcome }));
      return;
    }
    const release = overviewReleaseMode === "current"
      ? serverRelease && serverRelease !== "unknown" ? serverRelease : ""
      : overviewReleaseMode === "all" ? "" : overviewFilters.release;
    setDiagnosticReleaseMode(overviewReleaseMode);
    setDiagnosticFilters({ ...overviewFilters, source: "server", operation: "", model: "", release, outcome });
    setOffset(0);
    setView("diagnostics");
    window.requestAnimationFrame(() => document.querySelector(".admin-traces")?.scrollIntoView?.({ block: "start" }));
  };
  const openPlaybackDiagnostics = () => {
    const release = overviewReleaseMode === "current"
      ? ""
      : overviewReleaseMode === "all" ? "" : overviewFilters.release;
    setDiagnosticReleaseMode(overviewReleaseMode);
    setDiagnosticFilters({ ...overviewFilters, source: "browser", operation: "speech.complete", model: "", release, outcome: "" });
    setOffset(0);
    setView("diagnostics");
    window.requestAnimationFrame(() => document.querySelector(".admin-traces")?.scrollIntoView?.({ block: "start" }));
  };
  const changeSource = (source: "server" | "browser") => {
    if (source === filters.source) return;
    const release = releaseMode === "current"
      ? source === "browser" ? "" : knownRelease(serverRelease) ?? ""
      : releaseMode === "all" ? "" : filters.release;
    update({ source, operation: "", model: "", release, outcome: "", delivery: "all" });
  };
  const changeRelease = (value: string) => {
    if (value === "__current") {
      setReleaseMode("current");
      update({ release: filters.source === "browser" ? "" : knownRelease(serverRelease) ?? "" });
    } else if (value === "__all") {
      setReleaseMode("all");
      update({ release: "" });
    } else {
      setReleaseMode("history");
      update({ release: value });
    }
  };
  const versionValue = releaseMode === "current" ? "__current" : releaseMode === "all" ? "__all" : filters.release;
  const selectedRelease = filters.source === "browser" ? browserRelease : serverRelease;
  const versionLabel = releaseMode === "current"
    ? `当前发布（${selectedRelease ? releaseLabel(selectedRelease) : "核对中"}）`
    : releaseMode === "all" ? "全部保留" : releaseLabel(filters.release);
  const refresh = () => {
    if (browserCurrent) setOffset(0);
    setRevision(value => value + 1);
  };

  const timeRange = <label className="admin-period">时间范围<select value={filters.hours}
    onChange={event => update({ hours: Number(event.target.value) })}>
    <option value={24}>近 24 小时</option><option value={168}>近 7 天</option><option value={336}>近 14 天</option>
  </select></label>;
  const releaseOptions = [...new Set([...(data?.facets?.releases ?? []), ...(filters.release ? [filters.release] : [])])];
  const versionSelect = <label>发布版本<select aria-label="发布版本" value={versionValue} onChange={e => changeRelease(e.target.value)}><option value="__current">当前发布</option><option value="__all">全部保留</option>{releaseOptions.map(r => <option key={r} value={r}>{releaseLabel(r)}</option>)}</select></label>;
  const trafficSelect = <label>流量范围<select value={filters.traffic}
    onChange={event => update({ traffic: event.target.value as AdminTraffic, testRunId: "" })}>
    <option value="unmarked">未标记流量</option><option value="test">仅测试流量</option><option value="all">全部流量</option>
  </select></label>;
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

  if (!canRead || denied) return <main className="admin-page admin-locked">
    <ShieldCheck size={34} /><h1>{denied ? "后台访问权限已失效" : "仅管理员可访问运行看板"}</h1>
    <p>{denied ? "请刷新账号权限并确认服务器管理员授权。" : "请使用已授权的管理员账号登录。"}</p>
    {user && <button className="admin-refresh" disabled={refreshingAccount} onClick={async () => {
      setRefreshingAccount(true);
      try {
        await useAuth.getState().refresh();
        if (useAuth.getState().user?.is_admin) {
          setDeniedAccount(null);
          setRevision(value => value + 1);
        }
      }
      finally { setRefreshingAccount(false); }
    }}><RefreshCw size={16} />{refreshingAccount ? "核对中…" : "刷新账号权限"}</button>}
    <Link to="/me">前往个人中心</Link>
  </main>;

  return <main className="admin-page">
    <header className="admin-heading"><div><span className="admin-eyebrow"><ShieldCheck size={14} /> SPOKEN · 仅管理员可见</span>
      <h1>运行看板<span>服务表现与使用情况</span></h1></div>
      {showsCalls && <div className="admin-heading-actions">{data && <span className={`admin-collection-state ${!data.collection.active ? "" : data.collection.dropped_since_restart || data.collection.write_errors_since_restart ? "degraded" : "enabled"}`}><i />{!data.collection.active ? "采集未启用" : data.collection.dropped_since_restart || data.collection.write_errors_since_restart ? "采集有缺口" : "采集已启用"}</span>}
        <button className="admin-refresh" disabled={loading} onClick={refresh}><RefreshCw size={15} className={loading ? "admin-spinning" : undefined} />{loading ? "加载中…" : "刷新数据"}</button>
      </div>}
    </header>
    <div className="admin-view-bar">
      <nav className="admin-view-nav" aria-label="运行看板分区">
        {views.map(({ id, label, icon: Icon }) => <button key={id} type="button"
          aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}><Icon size={16} />{label}</button>)}
      </nav>
      {view === "overview" && <>{timeRange}{versionSelect}{trafficSelect}</>}
    </div>
    {view === "users" ? <AdminUsers key={userId} onForbidden={rejectAccess} /> : view === "feedback" ?
      <AdminFeedbackInbox key={userId} selected={params.get("ticket")} onForbidden={rejectAccess}
        selectTicket={id => {
          const next = new URLSearchParams(params);
          if (id) next.set("ticket", id); else next.delete("ticket");
          setParams(next);
        }} /> : <>
    {diagnostics && <div className="admin-toolbar">
      <div role="tablist" aria-label="采集来源" className="admin-tabs">{(["server", "browser"] as const).map(source =>
        <button key={source} type="button" id={`admin-source-${source}`} role="tab" aria-controls="admin-source-panel"
          tabIndex={filters.source === source ? 0 : -1} aria-selected={filters.source === source} onClick={() => changeSource(source)}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "server" : event.key === "End" ? "browser" : source === "server" ? "browser" : "server";
            document.getElementById(`admin-source-${next}`)?.focus();
            changeSource(next);
          }}>{source === "server" ? "后端调用" : "浏览器体验"}</button>)}</div>
      {timeRange}{versionSelect}{trafficSelect}
      {filters.source === "browser" && <label>上报方式<select value={filters.delivery}
        onChange={event => update({ delivery: event.target.value as AdminDelivery })}>
        <option value="all">全部上报</option><option value="replay">仅补报</option>
      </select></label>}
      <label className="admin-operation">业务操作<select value={filters.operation} onChange={e => update({ operation: e.target.value })}><option value="">所有操作（混合样本）</option>{operationOptions.map(op => <option key={op} value={op}>{names[op] ?? op}</option>)}</select></label>
      {filters.source === "server" && <label>模型<select aria-label="模型" value={filters.model} onChange={e => update({ model: e.target.value })}><option value="">全部</option>{(data?.facets?.models ?? []).map(m => <option key={m}>{m}</option>)}</select></label>}
      <span className={`admin-release-state ${releaseMode}`} title={releaseMode === "current" ? selectedRelease ?? undefined : filters.release}>{versionLabel}</span>
    </div>}
    {filters.traffic === "test" && <TestRunFilter key={`${view}:${filters.testRunId}`} value={filters.testRunId}
      onApply={testRunId => update({ testRunId })} />}
    <div id={diagnostics ? "admin-source-panel" : undefined} role={diagnostics ? "tabpanel" : undefined}
      aria-labelledby={diagnostics ? `admin-source-${filters.source}` : undefined}>
    <div className="admin-scope-caption"><span>{filters.operation ? names[filters.operation] ?? filters.operation : "全部业务概览"}{diagnostics && !filters.operation && " · 性能比较请先选同一种操作"} · {versionLabel}{filters.testRunId && ` · 批次 ${filters.testRunId}`}</span>{!checkingBrowserRelease && <span>{updatedAt ? `概览更新于 ${date(updatedAt)}` : "仅展示已采集的真实记录"}</span>}</div>
    {coverage && <SampleRange coverage={coverage} listOnly={useListCoverage} />}
    {data?.count === 0 && releaseMode === "current" && knownRelease(selectedRelease) && <p className="admin-notice admin-empty-current" role="status">当前发布暂无可比较样本。可切换到「全部保留」或单个历史版本排障。</p>}
    {releaseMode === "current" && filters.source === "server" && serverRelease === "unknown" && <p className="admin-notice" role="status">后端当前版本未知，无法按「当前发布」比较；当前显示全部保留样本。</p>}
    {checkingBrowserRelease && <p className="admin-loading" role="status">正在核对线上前端发布版本…</p>}
    {browserRelease === "unknown" && browserReleaseScope && <p className="admin-notice" role="status">暂时无法确认线上前端版本。浏览器数据按全部保留版本显示。</p>}
    {diagnostics && <p className="admin-perspective">{filters.source === 'server'
      ? '服务端视角：接口收到请求至响应结束，看业务处理、模型调用和错误。「模型 / 类型」只在大模型调用时显示具体模型；读取、语音、写入和删除分别标为对应类型，只有 AI 调用缺失模型时才显示「AI 调用未记录」。'
      : '用户端视角：记录识别收尾、说完至首声、播放完成，包含网络、队列与播放等待。浏览器样本不提供后端模型或 Token，因此隐藏模型与费用区。'}</p>}
    {error && <p className="admin-notice" role="alert">{error}</p>}
    {overviewError && !checkingBrowserRelease && <p className="admin-notice admin-error-notice" role="alert"><TriangleAlert size={16} /><span>{overviewError}</span><button onClick={refresh}>重试</button></p>}
    {overviewLoading && !data && <p className="admin-loading" role="status">正在读取运行概览…</p>}
    {data && <>
      {filters.traffic !== "all" && !data.traffic_filter && <p className="admin-notice" role="status">此后端尚不支持流量筛选，当前展示全部流量。</p>}
      {filters.delivery === "replay" && !data.delivery_filter && <p className="admin-notice" role="status">后端更新后可筛选补报。当前显示全部上报。</p>}
      {filters.traffic === "unmarked" && data.traffic_filter && <p className="admin-scope-caption">未标记流量也可能包含历史测试。已标记的测试批次可在「仅测试流量」下查看。</p>}
      {filters.source === "browser" && <p className="admin-notice">浏览器上报可能缺失或被修改，独立于后端成功率与 Token 计量。朗读任务首声含等待文字与音频准备，不含之前的识别；整轮首声从检测到说话结束起计。</p>}
      {(!data.collection.active || data.collection.dropped_since_restart > 0 || data.collection.write_errors_since_restart > 0) && <p className="admin-notice" role="status">采集存在缺口：本进程启动后丢弃 {data.collection.dropped_since_restart} 条，写入失败 {data.collection.write_errors_since_restart} 次。{!data.collection.active && "采集未启用。"}</p>}
      {data.collection.at_capacity && <p className="admin-notice">此来源已达到 {data.collection.source_budget?.toLocaleString()} 条保留上限，时间窗可能不完整。{data.collection.oldest_at && `最早保留 ${date(data.collection.oldest_at)}（北京时间）。`}</p>}
      {filters.traffic === "test" && testBudget != null && testRetained != null && testRetained >= testBudget &&
        <p className="admin-notice">此来源已达到测试记录上限 {number(testBudget)} 条，时间窗可能不完整。</p>}
      {!diagnostics && data.collection.sources?.browser?.at_capacity && <p className="admin-notice">浏览器体验已达到 {number(data.collection.sources.browser.source_budget)} 条保留上限，语音体验的时间窗可能不完整。</p>}
      <section className="admin-metrics" aria-label="运行指标">
        <article><span><Activity size={16} />{filters.source === "server" ? "保留请求数" : "上报样本"}</span><strong>{number(data.count)}</strong><small>保留 {data.collection.retention_days} 天 · {data.collection.cleanup?.active ? '自动清理' : '写入时清理'}</small></article>
        <article><span><ShieldCheck size={16} />{filters.source === "server" ? "请求成功率" : "正常上报样本"}</span><strong>{filters.source === "browser" ? number(data.count - data.errors - data.timeouts - data.cancelled) : data.success_rate == null ? "—" : `${(data.success_rate * 100).toFixed(1)}%`}</strong><small>{filters.source === "server" ? `取消 ${data.cancelled} 次排除` : "端侧自报，独立于后端成功数"}</small></article>
        <article><span><Clock3 size={16} />P95 总耗时</span><strong>{ms(data.latency.p95)}</strong><small>P50 {ms(data.latency.p50)} · P99 {ms(data.latency.p99)}</small></article>
        <article className={data.errors + data.timeouts ? "admin-metric-alert" : undefined}>
          <span><TriangleAlert size={16} />{filters.source === "server" ? "失败 / 超时" : "异常样本"}</span>
          <strong>{number(data.errors + data.timeouts)}</strong>
          <div className="admin-issue-actions">
            <button aria-pressed={filters.outcome === "error"} onClick={() => filterOutcome("error")}>失败 {data.errors}</button>
            <button aria-pressed={filters.outcome === "timeout"} onClick={() => filterOutcome("timeout")}>超时 {data.timeouts}</button>
            {data.errors + data.timeouts > 0 && <button type="button" className="admin-failure-shortcut" aria-label="查看失败调用"
              onClick={() => filterOutcome(data.errors > 0 ? "error" : "timeout", true)}><ArrowRight size={14} /></button>}
          </div>
        </article>
      </section>
      {filters.source === "browser" && data.asr_replays && <AsrReplaySummary summary={data.asr_replays}
        onlyReplays={filters.delivery === "replay"} />}
      {!diagnostics && data.experience && <ExperienceOverview experience={data.experience}
        onPlaybackDetails={openPlaybackDiagnostics} />}
      <section className={`admin-panels${filters.source === "browser" ? " admin-panels-single" : ""}`}>
        <article className="admin-panel admin-trend"><div className="admin-panel-heading"><h2>耗时趋势</h2><span>每小时 P95 · 按业务分别统计</span></div>
          {data.trend.length ? (
            <>
              <EChart height={176} option={chart} />
              <details className="chart-data-details" open={trendOpen} onToggle={(event) => setTrendOpen(event.currentTarget.open)}>
                <summary>查看每小时耗时数据</summary>
                {trendOpen && (
                  <div className="chart-data-scroll" role="region" aria-label="每小时耗时数据" tabIndex={0}>
                    <table className="chart-data-table">
                      <caption className="sr-only">每小时耗时趋势（北京时间）</caption>
                      <thead>
                        <tr><th scope="col">时间 · 北京</th><th scope="col">业务操作</th><th scope="col">记录数</th><th scope="col">P95（毫秒）</th></tr>
                      </thead>
                      <tbody>
                        {data.trend.map((point) => (
                          <tr key={point.time + point.operation}>
                            <td><time dateTime={point.time}>{date(point.time)}</time></td>
                            <td>{names[point.operation] ?? point.operation}</td>
                            <td>{number(point.count)}</td>
                            <td>{point.p95 == null ? "无数据" : number(point.p95)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </details>
            </>
          ) : <div className="admin-chart-empty"><Clock3 size={23} /><strong>当前筛选还没有耗时样本</strong><span>可调整业务或时间范围；采集到真实请求后展示趋势。</span></div>}
          <div className="admin-status-line"><span>取消 <b>{data.cancelled}</b> 次，单独记录</span><span>各业务耗时独立观察</span></div>
        </article>
        {filters.source === "server" && <article className="admin-panel admin-usage"><div className="admin-panel-heading"><h2><Database size={16} />模型与费用</h2>{data.pricing && <code className="admin-model-name">{data.pricing.configured_model}</code>}</div>
          {data.pricing && <details className="admin-price-details"><summary><span>输入 ¥{data.pricing.rates.input_hit[0]}–{data.pricing.rates.input_miss[1]} /百万</span><span>输出 ¥{data.pricing.rates.output.join('–')} /百万</span></summary><div>
            <p>人民币 / 百万 Token。缓存命中输入 ¥{data.pricing.rates.input_hit.join('–')}，未命中输入 ¥{data.pricing.rates.input_miss.join('–')}。各项低/高值对应空闲/高峰。</p>
            <p>高峰为北京时间非节假日的工作日 9–12、14–18 点。费用区间采用全命中空闲价至全未命中高峰价，未考虑赠送额度或折扣。</p>
            <p>{data.pricing.official_version} · 核对 {data.pricing.checked_at} · <a href={data.pricing.source_url} target="_blank" rel="noreferrer">官方价格</a></p>
          </div></details>}
          <dl><div><dt>输入 Token</dt><dd>{number(data.input_tokens)}</dd></div><div><dt>输出 Token</dt><dd>{number(data.output_tokens)}</dd></div><div><dt>模型首文本 P95</dt><dd>{ms(data.ttft.p95)}</dd></div><div><dt>费用参考区间</dt><dd className="admin-cost-value">{referenceCost(data.pricing?.min_cny, data.pricing?.max_cny)}</dd></div></dl>
          <div className="admin-usage-coverage"><span>{data.pricing ? <>计价覆盖 <b>{data.pricing.priced_records} / {data.pricing.model_records}</b></> : <>完整用量 <b>{data.usage_known} / {data.count}</b></>}</span><span>首文本样本 <b>{data.ttft_known ?? 0}</b></span></div>
          <p>{data.pricing && data.pricing.model_records === 0 ? '当前没有模型调用样本。语音费用按所选引擎与讯飞资源包另计。' : `按公开单价重估已知用量，不代表实扣账单；${(data.pricing?.unknown_usage_records ?? 0) + (data.pricing?.unpriced_records ?? 0)} 条调用未完整计价。语音另计。`}</p>
        </article>}
      </section>
    </>}
    {diagnostics && <section className="admin-panel admin-traces" aria-label="调用记录">
      <div className="admin-panel-heading"><h2>调用记录 <span>{total} 条</span></h2><form className="admin-trace-lookup" onSubmit={event => {
        event.preventDefault(); const id = traceLookup.trim().toLowerCase();
        if (!/^[a-f0-9]{32}$/.test(id)) { setError("请输入 32 位十六进制 Trace ID。"); return; }
        void inspect(id);
      }}><label htmlFor="admin-trace-id"><Search size={15} />Trace ID</label><input id="admin-trace-id" value={traceLookup} onChange={event => setTraceLookup(event.target.value)} maxLength={64} autoComplete="off" spellCheck={false} placeholder="粘贴调用编号，直达详情" title="输入响应头 X-Trace-Id 中的 32 位调用编号" /><button disabled={detailLoading} type="submit">{detailLoading ? "查找中…" : "查找调用"}</button></form><div className="admin-table-controls">
        <label><input type="checkbox" checked={slow} onChange={e => { setOffset(0); setSlow(e.target.checked); }} />优先查看慢请求</label>
        <select aria-label="调用状态" value={filters.outcome} onChange={e => update({ outcome: e.target.value })}><option value="">全部状态</option>{Object.entries(labels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      </div></div>
      {listError && !checkingBrowserRelease && <p className="admin-notice admin-error-notice" role="alert"><TriangleAlert size={16} /><span>{listError}</span><button onClick={refresh}>重试</button></p>}
      <div className="admin-table-wrap" role="region" aria-label="调用记录表格" tabIndex={0} aria-busy={listLoading}><table><thead><tr><th scope="col">时间 · 北京</th><th scope="col">业务操作</th><th scope="col">状态</th><th scope="col">耗时</th>{filters.source === "server" && <><th scope="col">模型 / 类型</th><th scope="col">费用参考</th></>}<th scope="col">Trace</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.trace_id} data-outcome={row.outcome}><td><time dateTime={row.started_at}>{date(row.started_at)}</time></td><td className="admin-operation-cell"><strong>{names[row.operation] ?? row.operation}</strong><small>版本 {releaseLabel(row.release)}{row.audience === "guest" && " · 游客"}</small></td><td><span className="admin-row-status"><span className={`admin-badge ${row.outcome}`}>{labels[row.outcome] ?? row.outcome}</span>{row.is_replay && <span className="admin-badge replay">补报</span>}</span></td><td className="admin-duration">{ms(row.duration_ms)}</td>{filters.source === "server" && <><td>{modelLabel(row)}</td><td className="admin-row-cost" title="按已采集用量与公开单价参考；未计价不代表零费用">{referenceCost(row.cost_min_cny, row.cost_max_cny)}</td></>}<td><button type="button" aria-label={`查看调用 ${row.trace_id.slice(0, 8)}`} onClick={event => void inspect(row.trace_id, event.currentTarget)}>{row.trace_id.slice(0, 8)} <ArrowRight size={14} /></button></td></tr>)}
        {!rows.length && <tr><td colSpan={filters.source === "server" ? 7 : 5} className="admin-empty">{listLoading ? "正在读取调用记录…" : listError ? "列表读取失败，可点击上方重试。" : "暂无调用记录。可切换业务操作、状态或时间范围；这里不会生成演示数据。"}</td></tr>}
      </tbody></table></div>
      <div className="admin-pagination"><span>{listLoading ? "列表更新中 · " : ""}第 {total ? offset + 1 : 0}–{Math.min(offset + rows.length, total)} 条 / {total} · 状态筛选仅影响列表</span><div><button aria-label="上一页" disabled={listLoading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 50))}><ArrowLeft size={15} /></button><button aria-label="下一页" disabled={listLoading || offset + 50 >= total} onClick={() => setOffset(v => v + 50)}><ArrowRight size={15} /></button></div></div>
    </section>}
    {data && <footer className="admin-footnote"><ShieldCheck size={13} /><div>UTC 记录 · 北京时间展示 · 保留策略 {data.collection.retention_days} 天 / {data.collection.max_records.toLocaleString()} 条 · {data.collection.oldest_at ? `最早保留 ${date(data.collection.oldest_at)}` : "暂无保留数据"}
      {sourceRetention?.retained !== undefined && <p>此来源共保留 {number(sourceRetention.retained)} 条，包含所有版本和流量。</p>}
      {testBudget != null && testRetained != null && <p>此来源测试记录 {number(testRetained)} / {number(testBudget)} 条，使用来源剩余空间。</p>}
      {data.collection.cleanup?.active && <p>启动、每 {data.collection.cleanup.interval_seconds / 3600} 小时及写入时自动清理；实例休眠后在下次启动补清理。上次成功 {data.collection.cleanup.last_success_at ? date(data.collection.cleanup.last_success_at) : '尚未完成'}。{data.collection.cleanup.failures_since_restart > 0 && `本进程清理失败 ${data.collection.cleanup.failures_since_restart} 次。`}</p>}
      <p>分位数基于保留样本，历史失败保留供追踪。</p></div></footer>}
    </div>
    {detail && <TraceDetail detail={detail} onInspect={id => void inspect(id)} onClose={closeDetail} />}
    </>}
  </main>;
}

const stageNames: Record<string, string> = {
  "model.first_text": "模型请求至首段文本",
  "chat.first_text": "浏览器请求至首段文本",
  "chat.complete": "浏览器请求至全文返回",
  "speech.request_to_audio": "提交至播放开始回调",
};

function SampleRange({ coverage, listOnly }: { coverage: AdminSampleCoverage; listOnly: boolean }) {
  const { oldest_at, newest_at } = coverage;
  return <p className="admin-scope-caption"><span>
    {listOnly ? "调用列表样本范围" : "当前筛选样本范围"} · {oldest_at && newest_at ? <>
      <time dateTime={oldest_at}>{date(oldest_at)}</time>
      {newest_at !== oldest_at && <> 至 <time dateTime={newest_at}>{date(newest_at)}</time></>}
      （北京时间）
    </> : "暂无匹配记录"}
  </span></p>;
}

const replayPercent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 });

function AsrReplaySummary({ summary, onlyReplays }: { summary: AdminAsrReplays; onlyReplays: boolean }) {
  const { count, failed_count, unclassified_count, delay_samples, median_delay_ms } = summary;
  return <section className="admin-panel admin-replay-summary" aria-labelledby="admin-replay-heading">
    <div className="admin-panel-heading"><h2 id="admin-replay-heading">补报统计</h2>
      <span>按发生时间统计{onlyReplays && " · 比例基于全部上报"}</span></div>
    <dl>
      <div><dt>补报条数</dt><dd>{number(count)}</dd></div>
      <div><dt>占识别失败和超时</dt><dd>
        {failed_count ? replayPercent.format(count / failed_count) : "—"}
        <small>{failed_count ? `${number(count)} / ${number(failed_count)} 条` : "暂无识别失败和超时记录"}</small>
        {unclassified_count > 0 && <small>{number(unclassified_count)} 条上报方式未知</small>}
      </dd></div>
      <div><dt>收到间隔中位数</dt><dd>
        {median_delay_ms == null ? "—" : formatReplayDelay(median_delay_ms)}
        <small>{delay_samples ? `${number(delay_samples)} 条有时间记录` : "暂无有效时间样本"}</small>
      </dd></div>
    </dl>
  </section>;
}

function ExperienceOverview({ experience, onPlaybackDetails }: { experience: AdminExperience; onPlaybackDetails: () => void }) {
  const { stages, playback } = experience;
  const samples = playback.completed + playback.failed + playback.cancelled;
  const recoveryResults = playback.recovered + playback.recovery_failed + playback.recovery_cancelled;
  return <div className="admin-experience-grid">
    <section className="admin-panel" aria-label="新对话等待">
      <div className="admin-panel-heading"><h2><Clock3 size={16} />新对话等待</h2><span>流式场景对话</span></div>
      <div className="admin-table-wrap"><table><thead><tr><th scope="col">计时区间</th><th scope="col">P50</th><th scope="col">P95</th><th scope="col">样本</th></tr></thead>
        <tbody>{stages.map(stage => <tr key={stage.operation}>
          <td>{stageNames[stage.operation] ?? stage.operation}</td><td>{ms(stage.p50)}</td><td>{ms(stage.p95)}</td><td>{number(stage.samples)}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="admin-panel-caption">各行按成功采集的样本分别计算，起点和覆盖范围不同。播放开始取浏览器回调，各段分位数不累加。</p>
    </section>
    <section className="admin-panel" aria-label="语音播放结果">
      <div className="admin-panel-heading"><h2>语音播放结果</h2><button className="admin-inline-link" onClick={onPlaybackDetails}>查看记录 <ArrowRight size={14} /></button></div>
      <dl className="admin-voice-summary">
        <div><dt>播放完成</dt><dd>{samples ? number(playback.completed) : "—"}</dd></div>
        <div><dt>播放失败</dt><dd>{samples ? number(playback.failed) : "—"}</dd></div>
        <div><dt>回退后完成</dt><dd>{recoveryResults ? number(playback.recovered) : "—"}</dd></div>
        <div><dt>回退后失败</dt><dd>{recoveryResults ? number(playback.recovery_failed) : "—"}</dd></div>
      </dl>
      <p className="admin-panel-caption">{samples
        ? `${number(samples)} 条播放结果，取消 ${number(playback.cancelled)} 条。${playback.classified ? `有启动状态的 ${number(playback.classified)} 条中，${number(playback.never_started)} 条失败且未启动。` : "尚无新版启动状态样本。"}`
        : "暂无播放结果样本。"}{recoveryResults > 0 && `回退后取消 ${number(playback.recovery_cancelled)} 条。`} 回退属于播放结果的子集。</p>
    </section>
  </div>;
}

function TraceDetail({ detail, onInspect, onClose }: { detail: AdminTrace; onInspect: (id: string) => void; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, [detail.trace_id]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const failed = detail.outcome === "error" || detail.outcome === "timeout";
  const cancelled = detail.source === "browser" && detail.outcome === "cancelled";
  const diagnostic = detail.spans?.find(span => span.name === detail.operation)?.attributes;
  const asrReason = typeof diagnostic?.asr_reason === "string" ? asrReasonLabels[diagnostic.asr_reason] : undefined;
  const interrupted = diagnostic?.error_code === "canceled" || diagnostic?.error_code === "interrupted";
  const timedOutWhilePaused = diagnostic?.reason === "completion_timeout" && Number(diagnostic.pause_count) > 0;
  const browserDiagnosis = asrReason ?? (cancelled
    ? interrupted ? "浏览器语音引擎报告朗读被中断。触发来源未采集。" : "浏览器报告此任务已取消。触发来源未采集。"
    : timedOutWhilePaused ? "朗读曾进入暂停状态，之后未在限时内结束。暂停由谁触发尚未采集。"
      : "此浏览器样本没有可确认的失败原因。可结合下方阶段和同一轮调用排查。");
  const failedSpans = (detail.spans ?? []).filter(span => span.outcome === "error" || span.outcome === "timeout");
  const diagnosticText = (span: NonNullable<AdminTrace["spans"]>[number]) =>
    Object.entries(span.attributes ?? {}).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).map(([key, value]) => `${key}=${String(value)}`).join(" · ");
  const receivedAt = detail.received_at ?? detail.started_at;
  const deliveryDelay = detail.occurred_at && detail.received_at
    ? Date.parse(detail.received_at) - Date.parse(detail.occurred_at) : null;
  return <aside className="admin-detail" aria-label="调用详情"><header><div><span className="admin-eyebrow">调用详情</span><h2>{names[detail.operation] ?? detail.operation}</h2></div><button ref={closeButton} type="button" aria-label="关闭调用详情" onClick={onClose}><X size={20} /></button></header>
    <div className="admin-detail-status"><span className={`admin-badge ${detail.outcome}`}>{labels[detail.outcome] ?? detail.outcome}</span>{detail.is_replay && <span className="admin-badge replay">补报</span>}{detail.source === "server" && <time dateTime={detail.started_at}>{date(detail.started_at)}</time>}</div>
    <code className="admin-trace-id">{detail.trace_id}</code>
    {detail.interaction_id && <p className="admin-interaction-id">交互编号 <code>{detail.interaction_id}</code></p>}
    <div className="admin-trace-root"><div><span>总耗时</span><strong>{ms(detail.duration_ms)}</strong></div>{detail.source === "server" && <div><span>模型 / 类型</span><b>{modelLabel(detail)}</b></div>}</div>
    {detail.source === "server" && <p className="admin-detail-cost">费用参考：{referenceCost(detail.cost_min_cny, detail.cost_max_cny)}<small>依据当前公开价与已知用量区间，未计价不代表零费用。</small></p>}
    <dl className="admin-detail-meta"><div><dt>采集来源</dt><dd>{detail.source === "browser" ? "浏览器上报" : "后端请求"}</dd></div>
      {detail.source === "browser" && <>
        <div><dt>发生时间</dt><dd>{detail.occurred_at ? <time dateTime={detail.occurred_at}>{date(detail.occurred_at)}</time> : "未采集"}</dd></div>
        <div><dt>收到时间</dt><dd><time dateTime={receivedAt}>{date(receivedAt)}</time></dd></div>
        {detail.is_replay && <div><dt>发生至收到</dt><dd>{formatReplayDelay(deliveryDelay)}</dd></div>}
      </>}
      <div><dt>响应</dt><dd>{detail.source === "browser" ? "不适用 HTTP 状态" : detail.http_status == null ? "HTTP 状态未采集" : `HTTP ${detail.http_status}`}</dd></div><div><dt>发布版本</dt><dd>{releaseLabel(detail.release)}{isTestRelease(detail.release) && "（测试样本）"}</dd></div>{detail.test_run_id && <div><dt>测试批次</dt><dd>{detail.test_run_id}</dd></div>}{detail.source === "server" && <div><dt>模型首文本</dt><dd>{ms(detail.ttft_ms)}</dd></div>}</dl>
    {detail.audience === "guest" && <p className="admin-detail-cost">游客练习请求<small>近 7 天的保留样本按发生时间计入用户运营。</small></p>}
    {(failed || cancelled) && <section className="admin-failure-context"><h3><TriangleAlert size={16} />{cancelled ? "取消线索" : "失败线索"}</h3>
      {detail.source === "browser" ? <p>{browserDiagnosis}</p>
        : detail.error_type ? <><div className="admin-error-types"><code>{detail.error_type}</code>{detail.error_cause_type && <><ArrowRight size={13} /><code>{detail.error_cause_type}</code></>}</div><p>已采集异常类名；可按调用时间和编号核对服务端日志。</p></>
        : detail.http_status != null && detail.http_status >= 400 ? <p>服务返回 HTTP {detail.http_status}，响应中的具体错误内容未留存。</p>
        : <p>此记录未采集异常类型，无法仅凭耗时判断原因；请结合时间和路径核对服务端日志。</p>}
      {!!failedSpans.length && <div className="admin-failure-diagnostics"><h4>阶段诊断</h4>{failedSpans.map(span => <p key={span.id}><strong>{span.name}</strong><span>{diagnosticText(span) || "未采集更多阶段参数"}</span></p>)}</div>}
      {failed && <small>历史失败保留用于追踪，不代表接口当前仍在报错。</small>}
    </section>}
    {!!detail.related?.length && <section className="admin-related"><h3>同一轮交互</h3><p>各端时钟独立，分别查看，不跨端累加。</p>{detail.related.map(row => <button key={row.trace_id} type="button" onClick={() => onInspect(row.trace_id)}><span>{names[row.operation] ?? row.operation}<small>{row.source === "browser" ? "浏览器上报" : "后端请求"} · {labels[row.outcome] ?? row.outcome}</small></span><b>{ms(row.duration_ms)}</b></button>)}</section>}
    <h3 className="admin-waterfall-title">阶段耗时</h3><p className="admin-waterfall-note">以下阶段共享该端的单调时钟，重叠阶段不累加为总耗时。</p>
    <div className="admin-waterfall">{detail.spans?.length ? detail.spans.map(span => <article key={span.id}><div><strong>{span.name}</strong><span>{ms(span.duration_ms)} · {spanLabels[span.outcome] ?? span.outcome}</span></div>
      <div className="admin-span-track"><i className={span.outcome} style={{ marginLeft: `${Math.min(99, span.offset_ms / Math.max(1, detail.duration_ms) * 100)}%`, width: `${Math.max(0.5, Math.min(100, span.duration_ms / Math.max(1, detail.duration_ms) * 100))}%` }} /></div>
      <dl>{Object.entries(span.attributes).map(([key, value]) => <div key={key}><dt>{span.name === "speech.complete" && key === "reason" ? "原音色启动失败原因" : measurementLabels[key] ?? key}</dt><dd>{String(value)}</dd></div>)}</dl>
    </article>) : <p className="admin-empty-spans">此请求没有已采集的子阶段，不据此推测等待位置。</p>}</div>
    <p className="admin-detail-note"><ShieldCheck size={13} />仅保留耗时、状态和白名单元数据，不保存用户问答、音频或凭据。</p>
  </aside>;
}
