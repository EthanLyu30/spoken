import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuth } from "../store/auth";
import Admin from "./Admin";
import { modelLabel } from "../lib/adminFormatting";
import { setToken, clearToken } from "../lib/authToken";

vi.mock("../components/EChart", () => ({ EChart: () => null }));
const overview = { source: "server", count: 0, success_rate: null, errors: 0, timeouts: 0, cancelled: 0,
  latency: { p50: null, p95: null, p99: null }, ttft: { p50: null, p95: null, p99: null },
  input_tokens: null, output_tokens: null, usage_known: 0, operations: [], trend: [],
  facets: { operations: ["POST /api/chat/stream", "POST /api/interview/score"], models: [], releases: [] },
  collection: { active: true, retention_days: 14, max_records: 20000, oldest_at: null, dropped_since_restart: 0, write_errors_since_restart: 0 } };
const user = { id: 7, email: "owner@example.com", display_name: "Owner", avatar_url: "", created_at: "2026-10-30", is_admin: true };
const monitoring = {
  visitors: { guest_uv: 12, registered_active: 3, enabled: true, started_at: '2026-10-31T01:00:00Z', hours: 24, max_records: 20000, at_capacity: false },
  pricing: { configured_model: 'deepseek-flash', official_version: 'DeepSeek-V4.1-Flash-1017', checked_at: '2026-10-31', source_url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', currency: 'CNY', per_tokens: 1000000,
    rates: { input_hit: [.02, .04], input_miss: [1, 2], output: [4, 8] }, model_records: 3, priced_records: 2, unknown_usage_records: 1, unpriced_records: 0, min_cny: .002, max_cny: .006 },
};
const trace = { trace_id: "a".repeat(32), started_at: "2026-10-30T02:00:00Z", source: "server", operation: "POST /api/chat/stream", outcome: "ok", duration_ms: 1200, http_status: 200, ttft_ms: 250, model: "deepseek-flash", input_tokens: 20, output_tokens: 10, release: "qa", spans: [{ id: "b".repeat(16), parent_id: null, name: "deepseek.stream", offset_ms: 50, duration_ms: 1100, outcome: "ok", attributes: { provider: "deepseek" } }] };
const fetcher = vi.fn();
const releaseFetcher = vi.fn();
const deployedRelease = "6a913ffe82bd1dff93eb46486f28ca54367b097b";
const releasePage = (release: string) => new Response(`<meta name="spoken-release" content="${release}">`);
function show(view = "diagnostics") {
  return render(<MemoryRouter initialEntries={[`/admin?view=${view}`]}><Admin /></MemoryRouter>);
}
const releaseParam = (url: string) => new URL(String(url), "http://localhost").searchParams.get("release");
const modelExperience = (samples: number, p50: number) => ({ stages: [{ operation: "model.first_text", samples, p50, p95: p50, p99: p50 }],
  playback: { completed: samples, failed: 0, cancelled: 0, classified: 0, never_started: 0, recovered: 0, recovery_failed: 0, recovery_cancelled: 0 } });
beforeEach(() => {
  setToken("test-admin-session");
  useAuth.setState({ user });
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview") ? overview : url.includes(`/traces/${trace.trace_id}`) ? trace : { items: [], total: 0 }), { status: 200 }));
  releaseFetcher.mockImplementation(async () => releasePage(deployedRelease));
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => url === "/index.html"
    ? releaseFetcher(url, options) : fetcher(url, options));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fetcher.mockReset(); releaseFetcher.mockReset(); clearToken(); useAuth.setState({ user: null }); });

it("refreshes current browser diagnostics against the deployed release with an old bundle open", async () => {
  vi.stubEnv("VITE_RELEASE", "previous-browser-bundle");
  show();
  fireEvent.click(screen.getByRole("tab", { name: "浏览器体验" }));
  const browserTraceReleases = () => fetcher.mock.calls.map(([url]) => new URL(url, "http://localhost"))
    .filter(url => url.pathname.endsWith("/traces") && url.searchParams.get("source") === "browser")
    .map(url => url.searchParams.get("release"));
  await waitFor(() => expect(browserTraceReleases()).toContain(deployedRelease));
  expect(browserTraceReleases()).not.toContain("previous-browser-bundle");
  expect(releaseFetcher).toHaveBeenCalledWith("/index.html", expect.objectContaining({ cache: "no-store" }));
  const nextRelease = "5e8da79282bd1dff93eb46486f28ca54367b097b";
  releaseFetcher.mockImplementation(async () => releasePage(nextRelease));
  const refresh = screen.getByRole("button", { name: "刷新数据" });
  await waitFor(() => expect(refresh).toBeEnabled());
  fireEvent.click(refresh);
  await waitFor(() => expect(browserTraceReleases().at(-1)).toBe(nextRelease));
  expect(screen.getAllByText(/当前发布（5e8da79282）/).length).toBeGreaterThan(0);
});

it("labels non-model operations by type instead of claiming a missing model", () => {
  expect(modelLabel({ ...trace, operation: "DELETE /api/words/{word_id}", model: null })).toBe("数据删除");
  expect(modelLabel({ ...trace, operation: "POST /api/telemetry/visit", model: null })).toBe("非模型调用");
  expect(modelLabel({ ...trace, operation: "POST /api/hint", model: null })).toBe("AI 调用未记录");
  expect(modelLabel({ ...trace, operation: "POST /api/chat/stream", model: "deepseek-flash" })).toBe("deepseek-flash");
});

it("does not load private data for guests or ordinary accounts", () => {
  useAuth.setState({ user: { ...user, is_admin: false } });
  show();
  expect(screen.getByText(/仅管理员/)).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
});

it("filters unmarked traffic by default and carries an exact test batch into playback diagnostics", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview")
    ? { ...overview, experience: modelExperience(0, 0), traffic_filter: true,
        collection: { ...overview.collection, sources: { browser: { source_budget: 5000, at_capacity: true } } } }
    : { items: [], total: 0 })));
  show("overview");
  expect(await screen.findByText(/浏览器体验已达到 5,000 条保留上限/)).toBeVisible();
  const filter = screen.getByLabelText("流量范围");
  expect(filter).toHaveValue("unmarked");
  fireEvent.change(filter, { target: { value: "test" } });
  fireEvent.change(screen.getByLabelText("测试批次 ID"), { target: { value: "smoke-a" } });
  fireEvent.click(screen.getByRole("button", { name: "筛选批次" }));
  fireEvent.click(await screen.findByRole("button", { name: "查看记录" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const query = new URL(String(url), "http://localhost");
    return query.pathname.endsWith("/traces") && query.searchParams.get("operation") === "speech.complete"
      && query.searchParams.get("traffic") === "test" && query.searchParams.get("test_run_id") === "smoke-a";
  })).toBe(true));
});

it('shows the configured model, rates and honest cost coverage', async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/overview')
    ? { ...overview, ...monitoring } : { items: [], total: 0 })));
  show(); await screen.findByText(/暂无调用记录/);
  expect(screen.getByText('deepseek-flash')).toBeVisible();
  expect(screen.getByText(/输入 ¥0.02–2/)).toBeVisible();
  expect(screen.getByText(/输出 ¥4–8/)).toBeVisible();
  expect(screen.getByText(/¥0.0020–0.0060/)).toBeVisible();
  expect(screen.getByText(/2 \/ 3/)).toBeVisible();
});

it("loads accounts independently after an overview error and refreshes the active view", async () => {
  let registered = 105;
  let finishRefresh: (response: Response) => void = () => {};
  const userPage = () => new Response(JSON.stringify({
    items: [{ id: 1, email: "learner@example.test", display_name: "Learner",
      created_at: "2026-10-30T00:00:00Z", last_active: null, sessions: 0, words: 0, practice: 0 }],
    registered, total: registered, limit: 20, new_7d: 4, visitors: monitoring.visitors,
    activation_24h: { eligible: 4, completed: 1 },
    guest_activity: { hours: 168, active_browsers: 5, sessions: 8, pronunciation: 3, interviews: 2, word_collections: 4, word_reviews: 7 },
  }));
  fetcher.mockImplementation(async (url: string) => url.includes("/users")
    ? userPage()
    : new Response("{}", { status: 500 }));
  show("overview");
  expect(await screen.findByText(/概览暂时无法加载/)).toBeVisible();
  expect(fetcher.mock.calls.every(([url]) => !String(url).includes("/traces") && !String(url).includes("/users"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "用户运营" }));
  expect(await screen.findByText("learner@example.test")).toBeVisible();
  const metrics = screen.getByRole("region", { name: "用户指标" });
  expect(within(metrics).getByText("105")).toBeVisible();
  expect(within(metrics).getByText("3")).toBeVisible();
  const guests = within(screen.getByRole("region", { name: "游客使用" }));
  expect(guests.getByText("12")).toBeVisible();
  expect(guests.getByText("8")).toBeVisible();
  expect(screen.getByText("25.0%")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "浏览器体验" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "learner" } });
  fireEvent.click(screen.getByRole("button", { name: /^搜索$/ }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("search=learner"))).toBe(true));
  const refresh = screen.getByRole("button", { name: "刷新数据" });
  await waitFor(() => expect(refresh).toBeEnabled());
  registered = 106;
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { finishRefresh = resolve; }));
  fireEvent.click(refresh);
  expect(refresh).toBeDisabled();
  expect(screen.getByText("正在刷新用户数据…")).toBeVisible();
  expect(within(metrics).getByText("105")).toBeVisible();
  expect(String(fetcher.mock.lastCall?.[0])).toContain("search=learner");
  await act(async () => finishRefresh(userPage()));
  expect(await within(metrics).findByText("106")).toBeVisible();
  expect(screen.getByText(/用户数据更新于/)).toBeVisible();
});

it("shows per-stage samples on the overview and opens playback diagnostics", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview")
    ? { ...overview, experience: {
      stages: [{ operation: "chat.first_text", samples: 3, p50: 200, p95: 300, p99: 300 }],
      playback: { completed: 4, failed: 2, cancelled: 0, classified: 3, never_started: 1,
        recovered: 2, recovery_failed: 1, recovery_cancelled: 0 },
    } } : { items: [], total: 0 })));
  show("overview");
  const stages = await screen.findByRole("region", { name: "新对话等待" });
  expect(within(stages).getByText("300 ms")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
  expect(await screen.findByRole("region", { name: "调用记录" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("tab", { name: "浏览器体验" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByLabelText("业务操作")).toHaveValue("speech.complete");
});

it("does not present a legacy capped account response as the global count", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ items: [], registered: 100, limit: 100 })));
  show("users");
  expect(await screen.findByRole("alert")).toHaveTextContent("账号列表加载失败");
  expect(screen.queryByText("100")).not.toBeInTheDocument();
});

it("does not infer first-practice eligibility while account data is unavailable", async () => {
  let finishRequest: (response: Response) => void = () => {};
  fetcher.mockImplementation(() => new Promise<Response>(resolve => { finishRequest = resolve; }));
  show("users");
  const activation = within(screen.getByRole("region", { name: "首练转化" }));
  expect(activation.getByText("正在读取首练数据…")).toBeVisible();
  await act(async () => finishRequest(new Response("{}", { status: 500 })));
  expect(activation.getByText("首练数据暂不可用")).toBeVisible();
  expect(activation.queryByText("新注册账号尚未满 24 小时")).not.toBeInTheDocument();
});

it("defaults the overview to actual server release and supports all/history scopes", async () => {
  const current = {
    ...overview, server_release: "server-current", count: 2,
    facets: { ...overview.facets, releases: ["server-current", "browser-current", "development", "unknown"] },
  };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? current : { items: [], total: 0 })));
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-current")).toBe(true));
  const version = screen.getByLabelText("发布版本");
  expect(version).toHaveValue("__current");
  expect(screen.getByText(/当前发布（server-cur/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "调用诊断" }));
  fireEvent.click(await screen.findByRole("tab", { name: "浏览器体验" }));
  const browserRelease = deployedRelease;
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url);
    return value.includes("source=browser") && releaseParam(value) === browserRelease;
  })).toBe(true));
  fireEvent.change(screen.getByLabelText("发布版本"), { target: { value: "__all" } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url);
    return value.includes("source=browser") && releaseParam(value) === null;
  })).toBe(true));
  fireEvent.change(screen.getByLabelText("发布版本"), { target: { value: "development" } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "development")).toBe(true));
});

it("shows an explicit empty state when the current release has no samples", async () => {
  const empty = {
    ...overview, server_release: "server-empty", count: 0, errors: 0,
    facets: { ...overview.facets, releases: ["server-empty", "development", "unknown"] },
  };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? empty : { items: [], total: 0 })));
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-empty")).toBe(true));
  expect(await screen.findByText(/当前发布暂无可比较样本/)).toBeVisible();
  expect(screen.getByRole("option", { name: /测试 · development/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "未知版本" })).toBeInTheDocument();
});

it("keeps overview and diagnostics scopes independent", async () => {
  const current = { ...overview, server_release: "server-current", count: 2 };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? current : { items: [], total: 0 })));
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-current")).toBe(true));
  expect(screen.getByLabelText("发布版本")).toHaveValue("__current");
  fireEvent.click(screen.getByRole("button", { name: "调用诊断" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "浏览器体验" })).toBeVisible());
  fireEvent.click(screen.getByRole("tab", { name: "浏览器体验" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url); return value.includes("source=browser") && releaseParam(value) === deployedRelease;
  })).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "运行概览" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url); const params = new URL(value, "http://localhost").searchParams;
    return params.get("source") === "server" && params.get("release") === "server-current" && params.get("operation") === null;
  })).toBe(true));
});

it("shows unknown backend release without pretending it is current", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? { ...overview, server_release: "unknown", count: 1 } : { items: [], total: 0 })));
  show("overview");
  expect(await screen.findByText(/后端当前版本未知/)).toBeVisible();
  expect(screen.getByLabelText("发布版本")).toHaveValue("__current");
});

it("keeps a historical version selected across diagnostics sources", async () => {
  const current = { ...overview, server_release: "server-current", count: 2,
    facets: { ...overview.facets, releases: ["server-current", "development"] } };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? current : { items: [], total: 0 })));
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-current")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "调用诊断" }));
  await waitFor(() => expect(screen.getByLabelText("发布版本")).toBeVisible());
  fireEvent.change(screen.getByLabelText("发布版本"), { target: { value: "development" } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "development")).toBe(true));
  fireEvent.click(screen.getByRole("tab", { name: "浏览器体验" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url); return value.includes("source=browser") && releaseParam(value) === "development";
  })).toBe(true));
  expect(screen.getByLabelText("发布版本")).toHaveValue("development");
  fireEvent.click(screen.getByRole("tab", { name: "后端调用" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url); return value.includes("source=server") && releaseParam(value) === "development";
  })).toBe(true));
});

it("uses the frontend release for playback drilldown while keeping the backend scope separate", async () => {
  const current = { ...overview, server_release: "server-current", count: 2,
    experience: { stages: [], playback: { completed: 1, failed: 0, cancelled: 0, classified: 0, never_started: 0, recovered: 0, recovery_failed: 0, recovery_cancelled: 0 } } };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? current : { items: [], total: 0 })));
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-current")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => {
    const value = String(url); const params = new URL(value, "http://localhost").searchParams;
    return params.get("source") === "browser" && params.get("operation") === "speech.complete"
      && params.get("release") === deployedRelease
      && params.get("experience_server_release") === "server-current";
  })).toBe(true));
});

it("does not inherit the backend release for browser experience when frontend release is unknown", async () => {
  releaseFetcher.mockImplementation(async () => new Response("<title>Spoken</title>"));
  fetcher.mockImplementation(async (url: string) => {
    if (!String(url).includes("/overview")) return new Response(JSON.stringify({ items: [], total: 0 }));
    const params = new URL(String(url), "http://localhost").searchParams;
    const inherited = params.get("experience_browser_release") === "server-current";
    return new Response(JSON.stringify({ ...overview, count: 2, server_release: "server-current",
      experience: { stages: [{ operation: "chat.first_text", samples: inherited ? 1 : 2,
        p50: inherited ? 900 : 100, p95: inherited ? 900 : 100, p99: inherited ? 900 : 100 }],
        playback: { completed: 2, failed: 0, cancelled: 0, classified: 0, never_started: 0, recovered: 0, recovery_failed: 0, recovery_cancelled: 0 } } }));
  });
  show("overview");
  await waitFor(() => {
    const latest = fetcher.mock.calls.map(([url]) => new URL(String(url), "http://localhost"))
      .filter(url => url.pathname.endsWith("/admin/overview")).at(-1);
    expect(latest?.searchParams.get("release")).toBe("server-current");
    expect(latest?.searchParams.get("experience_server_release")).toBe("server-current");
    expect(latest?.searchParams.get("experience_browser_release")).toBe("__all");
  });
  const stages = await screen.findByRole("region", { name: "新对话等待" });
  const row = within(stages).getByRole("row", { name: /浏览器请求至首段文本/ });
  expect(within(row).getAllByText("100 ms")).toHaveLength(2);
  expect(within(row).getByText("2")).toBeVisible();
  expect(within(row).queryByText("900 ms")).not.toBeInTheDocument();
});

it("keeps the model card on the full retained scope when current release is unknown", async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (!String(url).includes("/overview")) return new Response(JSON.stringify({ items: [], total: 0 }));
    const params = new URL(String(url), "http://localhost").searchParams;
    const filtered = params.get("experience_server_release") === "unknown";
    return new Response(JSON.stringify({ ...overview, count: 2, server_release: "unknown",
      experience: modelExperience(filtered ? 1 : 2, filtered ? 900 : 100) }));
  });
  show("overview");
  expect(await screen.findByText(/后端当前版本未知/)).toBeVisible();
  const stages = await screen.findByRole("region", { name: "新对话等待" });
  const row = within(stages).getByRole("row", { name: /模型请求至首段文本/ });
  expect(within(row).getAllByText("100 ms")).toHaveLength(2);
  expect(within(row).getByText("2")).toBeVisible();
  expect(within(row).queryByText("900 ms")).not.toBeInTheDocument();
  const latest = fetcher.mock.calls.map(([url]) => new URL(String(url), "http://localhost"))
    .filter(url => url.pathname.endsWith("/admin/overview")).at(-1);
  expect(latest?.searchParams.get("release")).toBeNull();
  expect(latest?.searchParams.get("experience_server_release")).toBeNull();
});

it("keeps an explicitly selected unknown version filtered", async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (!String(url).includes("/overview")) return new Response(JSON.stringify({ items: [], total: 0 }));
    const params = new URL(String(url), "http://localhost").searchParams;
    const explicitUnknown = params.get("release") === "unknown" || params.get("experience_server_release") === "unknown";
    return new Response(JSON.stringify({ ...overview, count: explicitUnknown ? 1 : 2, server_release: "server-current",
      facets: { ...overview.facets, releases: ["server-current", "unknown"] },
      experience: modelExperience(explicitUnknown ? 1 : 2, explicitUnknown ? 900 : 100) }));
  });
  show("overview");
  await waitFor(() => expect(screen.getByLabelText("发布版本")).toHaveValue("__current"));
  fireEvent.change(screen.getByLabelText("发布版本"), { target: { value: "unknown" } });
  await waitFor(() => {
    const latest = fetcher.mock.calls.map(([url]) => new URL(String(url), "http://localhost")).filter(url => url.pathname.endsWith("/admin/overview")).at(-1);
    expect(latest?.searchParams.get("release")).toBe("unknown");
    expect(latest?.searchParams.get("experience_server_release")).toBe("unknown");
  });
  const stages = await screen.findByRole("region", { name: "新对话等待" });
  const row = within(stages).getByRole("row", { name: /模型请求至首段文本/ });
  expect(within(row).getAllByText("900 ms")).toHaveLength(2);
  expect(within(row).getByText("1")).toBeVisible();
});

it("keeps browser source and operation when filtering failures inside diagnostics", async () => {
  const browserOverview = { ...overview, source: "browser", count: 2, errors: 1, failure: 0,
    facets: { ...overview.facets, operations: ["speech.complete"] } };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? browserOverview : { items: [], total: 0 })));
  show("diagnostics");
  await waitFor(() => expect(screen.getByRole("tab", { name: "浏览器体验" })).toBeVisible());
  fireEvent.click(screen.getByRole("tab", { name: "浏览器体验" }));
  await waitFor(() => expect(screen.getByLabelText("业务操作")).toHaveValue(""));
  fireEvent.change(screen.getByLabelText("业务操作"), { target: { value: "speech.complete" } });
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("source=browser") && String(url).includes("operation=speech.complete"))).toBe(true));
  const before = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /^失败 1$/ }));
  await waitFor(() => {
    const later = fetcher.mock.calls.slice(before).map(([url]) => new URL(String(url), "http://localhost"));
    expect(later.some(url => url.pathname.endsWith("/admin/traces")
      && url.searchParams.get("source") === "browser"
      && url.searchParams.get("operation") === "speech.complete"
      && url.searchParams.get("outcome") === "error")).toBe(true);
  });
  expect(screen.getByRole("tab", { name: "浏览器体验" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByLabelText("业务操作")).toHaveValue("speech.complete");
  expect(screen.getByRole("button", { name: /^失败 1$/ })).toHaveAttribute("aria-pressed", "true");
});

it("resets the diagnostics page when drilling in from overview", async () => {
  const large = { ...overview, count: 100, errors: 1, facets: { ...overview.facets, operations: ["speech.complete"] } };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? large : { items: [trace], total: 100 })));
  show("diagnostics");
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => new URL(String(url), "http://localhost").searchParams.get("offset") === "50")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "运行概览" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "运行指标" })).toBeVisible());
  const before = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: /^失败 1$/ }));
  await waitFor(() => {
    const later = fetcher.mock.calls.slice(before).map(([url]) => new URL(String(url), "http://localhost"));
    expect(later.some(url => url.pathname.endsWith("/admin/traces") && url.searchParams.get("offset") === "0")).toBe(true);
  });
  expect(await screen.findByText(/第 1–1 条 \/ 100/)).toBeVisible();
});

it("resets the page for playback drilldown from overview", async () => {
  const large = { ...overview, count: 100, errors: 1,
    experience: { stages: [], playback: { completed: 1, failed: 0, cancelled: 0, classified: 0, never_started: 0, recovered: 0, recovery_failed: 0, recovery_cancelled: 0 } },
    facets: { ...overview.facets, operations: ["speech.complete"] } };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(
    String(url).includes("/overview") ? large : { items: [trace], total: 100 })));
  show("diagnostics");
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => new URL(String(url), "http://localhost").searchParams.get("offset") === "50")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "运行概览" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "查看记录" })).toBeVisible());
  const before = fetcher.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "查看记录" }));
  await waitFor(() => {
    const later = fetcher.mock.calls.slice(before).map(([url]) => new URL(String(url), "http://localhost"));
    expect(later.some(url => url.pathname.endsWith("/admin/traces") && url.searchParams.get("offset") === "0"
      && url.searchParams.get("operation") === "speech.complete")).toBe(true);
  });
  expect(await screen.findByText(/第 1–1 条 \/ 100/)).toBeVisible();
});

it("clears the old release query when a known release refreshes to unknown", async () => {
  let overviewCalls = 0;
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes("/overview")) {
      overviewCalls += 1;
      const params = new URL(String(url), "http://localhost").searchParams;
      const current = overviewCalls <= 2;
      const filtered = params.get("experience_server_release") === "unknown";
      return new Response(JSON.stringify({ ...overview, count: current ? 2 : 2,
        server_release: current ? "server-current" : "unknown",
        experience: modelExperience(filtered ? 1 : 2, filtered ? 900 : 100) }));
    }
    return new Response(JSON.stringify({ items: [], total: 0 }));
  });
  show("overview");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => releaseParam(String(url)) === "server-current")).toBe(true));
  const refresh = screen.getByRole("button", { name: "刷新数据" });
  await waitFor(() => expect(refresh).toBeEnabled());
  const before = fetcher.mock.calls.length;
  fireEvent.click(refresh);
  expect(await screen.findByText(/后端当前版本未知/)).toBeVisible();
  const overviewAfter = fetcher.mock.calls.slice(before)
    .map(([url]) => new URL(String(url), "http://localhost"))
    .filter(url => url.pathname.endsWith("/admin/overview"));
  expect(overviewAfter.at(-1)?.searchParams.get("release")).toBeNull();
  expect(overviewAfter.at(-1)?.searchParams.get("experience_server_release")).toBe("__all");
  const stages = await screen.findByRole("region", { name: "新对话等待" });
  const row = within(stages).getByRole("row", { name: /模型请求至首段文本/ });
  expect(within(row).getAllByText("100 ms")).toHaveLength(2);
  expect(within(row).getByText("2")).toBeVisible();
  expect(within(row).queryByText("900 ms")).not.toBeInTheDocument();
});

it("opens the first scoped failure from the overview shortcut", async () => {
  const failure = { ...trace, outcome: "error", http_status: 500 };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview")
    ? { ...overview, count: 4, errors: 1 } : url.includes(`/traces/${trace.trace_id}`)
      ? failure : { items: [failure], total: 1 })));
  show("overview");
  fireEvent.click(await screen.findByRole("button", { name: "查看失败调用" }));
  expect(await screen.findByRole("complementary", { name: "调用详情" })).toBeVisible();
  expect(screen.getByLabelText("调用状态")).toHaveValue("error");
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/traces?"))).toHaveLength(1);
});

it('explains both observation sources and the periodic retention policy', async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/overview')
    ? { ...overview, ...monitoring, collection: { ...overview.collection, cleanup: { active: true, interval_seconds: 3600, last_success_at: '2026-10-31T02:00:00Z', failures_since_restart: 0 } } }
    : { items: [], total: 0 })));
  show(); await screen.findByText(/暂无调用记录/);
  expect(screen.getByText(/服务端视角/)).toBeVisible();
  expect(screen.getByText(/每 1 小时/)).toBeVisible();
  expect(screen.getByText(/下次启动补清理/)).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '浏览器体验' }));
  expect(await screen.findByText(/用户端视角/)).toBeVisible();
});

it("starts with all operations for both independently measured sources", async () => {
  show(); await screen.findByText(/暂无调用记录/);
  expect(screen.getByLabelText("业务操作")).toHaveValue("");
  fireEvent.click(screen.getByRole("tab", { name: "浏览器体验" }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("source=browser"))).toBe(true));
  expect(screen.getByLabelText("业务操作")).toHaveValue("");
  expect(fetcher.mock.calls.every(([url]) => !new URL(String(url), "http://localhost").searchParams.has("operation"))).toBe(true);
});

it("filters failed traces without changing the overview denominator", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview")
    ? { ...overview, count: 4, errors: 1, success_rate: 0.75 } : { items: [], total: 0 })));
  show(); await screen.findByText("75.0%");
  fireEvent.click(screen.getByRole("button", { name: /^失败 1$/ }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("outcome=error"))).toBe(true));
  expect(screen.getByLabelText("调用状态")).toHaveValue("error");
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes("/overview")).every(([url]) => !String(url).includes("outcome="))).toBe(true);
  expect(await screen.findByText("75.0%")).toBeVisible();
});

it.each(["overview", "traces"])("keeps the other panel usable if %s fails", async failed => {
  fetcher.mockImplementation(async (url: string) => String(url).includes(`/admin/${failed}`)
    ? new Response("{}", { status: 500 })
    : new Response(JSON.stringify(String(url).includes("/overview") ? { ...overview, count: 42 } : { items: [trace], total: 1 })));
  show();
  if (failed === "overview") {
    expect(await screen.findByRole("button", { name: /查看调用/ })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("概览暂时无法加载");
  } else {
    expect(await screen.findByText("42")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("调用列表暂时无法加载");
  }
});

it("labels retained overview results after refresh fails, and clears them on a new scope", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview") ? { ...overview, count: 42 } : { items: [], total: 0 })));
  show(); await screen.findByText("42");
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled());
  fetcher.mockImplementation(async (url: string) => url.includes("/overview") ? new Response("{}", { status: 500 }) : new Response('{"items":[],"total":0}'));
  fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
  expect(await screen.findByText(/概览刷新失败，当前显示上次成功加载的数据/)).toBeVisible();
  expect(screen.getByText("42")).toBeVisible();
  fireEvent.click(screen.getByLabelText("优先查看慢请求"));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("slow_first=true"))).toBe(true));
  expect(screen.getByText(/概览刷新失败，当前显示上次成功加载的数据/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "168" } });
  await waitFor(() => expect(screen.queryByText("42")).not.toBeInTheDocument());
});

it.each(["sort", "status"])("finishes a pending overview refresh after a table %s change", async action => {
  const pending: ((response: Response) => void)[] = [];
  let overviewReads = 0;
  fetcher.mockImplementation((url: string) => {
    if (!url.includes("/overview")) return Promise.resolve(new Response('{"items":[],"total":0}'));
    overviewReads += 1;
    return overviewReads === 1 ? Promise.resolve(new Response(JSON.stringify({ ...overview, count: 4 })))
      : new Promise<Response>(resolve => pending.push(resolve));
  });
  show(); await screen.findByText("4");
  await waitFor(() => expect(screen.getByRole("button", { name: "刷新数据" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "刷新数据" }));
  if (action === "sort") fireEvent.click(screen.getByLabelText("优先查看慢请求"));
  else fireEvent.change(screen.getByLabelText("调用状态"), { target: { value: "error" } });
  await act(async () => { pending.forEach(resolve => resolve(new Response(JSON.stringify({ ...overview, count: 42 })))); });
  expect(await screen.findByText("42")).toBeVisible();
});

it.each([undefined, null, "OperationalError"])("shows honest diagnostics for old/new failure metadata (%s)", async errorType => {
  const failure = { ...trace, outcome: "error", http_status: null, spans: [], error_type: errorType, error_cause_type: errorType ? "AdminShutdown" : null };
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview")
    ? { ...overview, count: 1, errors: 1 } : url.includes(`/traces/${trace.trace_id}`) ? failure : { items: [failure], total: 1 })));
  show(); fireEvent.click(await screen.findByRole("button", { name: /查看调用/ }));
  const detail = await screen.findByRole("complementary", { name: "调用详情" });
  if (errorType) {
    expect(within(detail).getByText("OperationalError")).toBeVisible();
    expect(within(detail).getByText("AdminShutdown")).toBeVisible();
  } else expect(within(detail).getByText(/未采集异常类型/)).toBeVisible();
  expect(within(detail).getByText("HTTP 状态未采集")).toBeVisible();
  expect(within(detail).queryByText(/已修复|HTTP 500/)).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("complementary", { name: "调用详情" })).not.toBeInTheDocument();
});

it.each([true, false])("refreshes an existing account's server role (%s) before reading private data", async authorized => {
  useAuth.setState({ user: { ...user, is_admin: false } });
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/api/auth/me') ? { ...user, is_admin: authorized }
    : url.includes('/overview') ? overview : { items: [], total: 0 }), { status: 200 }));
  show();
  fireEvent.click(screen.getByRole('button', { name: '刷新账号权限' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/auth/me'))).toBe(true));
  if (authorized) expect(await screen.findByRole('heading', { name: /运行看板/ })).toBeVisible();
  else {
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新账号权限' })).toBeEnabled());
    expect(screen.getByText(/仅管理员/)).toBeVisible();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/api/admin/'))).toBe(false);
  }
});

it("retries private reads after a stale administrator denial is refreshed", async () => {
  fetcher.mockResolvedValue(new Response('{}', { status: 403 }));
  show();
  await screen.findByText(/权限已失效/);
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes('/api/auth/me') ? user
    : url.includes('/overview') ? overview : { items: [], total: 0 }), { status: 200 }));
  fireEvent.click(screen.getByRole('button', { name: '刷新账号权限' }));
  expect(await screen.findByRole('heading', { name: /运行看板/ })).toBeVisible();
});

it("shows empty measurements honestly and keeps business filters aligned", async () => {
  show();
  expect(await screen.findByText(/暂无调用记录/)).toBeVisible();
  expect(screen.queryByText("100%" )).not.toBeInTheDocument();
  expect(screen.queryByText("0 ms")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("业务操作"), { target: { value: "POST /api/interview/score" } });
  await waitFor(() => expect(fetcher.mock.calls.filter(([url]) => String(url).includes("operation=POST+%2Fapi%2Finterview%2Fscore"))).toHaveLength(2));
});

it("displays a trace without treating nested spans as additive duration", async () => {
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview") ? { ...overview, count: 1 } : url.includes(`/traces/${trace.trace_id}`) ? trace : { items: [trace], total: 1 }), { status: 200 }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: /查看调用/ }));
  expect(await screen.findByRole("complementary", { name: "调用详情" })).toBeVisible();
  expect(screen.getByText("deepseek.stream")).toBeVisible();
  expect(screen.getByText(/重叠阶段不累加/)).toBeVisible();
});

it("clears private data if the server rejects a stale administrator flag", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ detail: "forbidden" }), { status: 403 }));
  show();
  expect(await screen.findByText(/权限已失效/)).toBeVisible();
  expect(screen.queryByText(/输入 Token/)).not.toBeInTheDocument();
});

it("aborts pending private overview reads as soon as the list rejects access", async () => {
  fetcher.mockImplementation((url: string) => url.includes("/overview")
    ? new Promise<Response>(() => {}) : Promise.resolve(new Response("{}", { status: 403 })));
  show(); await screen.findByText(/权限已失效/);
  expect(fetcher.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
});

it("aborts a pending list when direct trace lookup rejects access", async () => {
  show(); await screen.findByText(/暂无调用记录/);
  fetcher.mockImplementation((url: string) => url.includes(`/traces/${trace.trace_id}`)
    ? Promise.resolve(new Response("{}", { status: 403 })) : new Promise<Response>(() => {}));
  fireEvent.click(screen.getByLabelText("优先查看慢请求"));
  fireEvent.change(screen.getByLabelText("Trace ID"), { target: { value: trace.trace_id } });
  fireEvent.click(screen.getByRole("button", { name: "查找调用" }));
  await screen.findByText(/权限已失效/);
  const pending = fetcher.mock.calls.find(([url]) => String(url).includes("slow_first=true"));
  expect(pending?.[1].signal.aborted).toBe(true);
});

it("aborts in-flight reads and hides private results on logout", async () => {
  show();
  await screen.findByText(/暂无调用记录/);
  const signals = fetcher.mock.calls.map(([, options]) => options.signal as AbortSignal);
  act(() => useAuth.setState({ user: null }));
  expect(screen.getByText(/仅管理员/)).toBeVisible();
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

it("looks up a known Trace ID even when it is not in the current table", async () => {
  show(); await screen.findByText(/暂无调用记录/);
  fireEvent.change(screen.getByLabelText("Trace ID"), { target: { value: trace.trace_id } });
  fireEvent.click(screen.getByRole("button", { name: "查找调用" }));
  expect(await screen.findByRole("complementary", { name: "调用详情" })).toBeVisible();
});

it("rejects malformed Trace IDs before requesting a private detail", async () => {
  show(); await screen.findByText(/暂无调用记录/); fetcher.mockClear();
  fireEvent.change(screen.getByLabelText("Trace ID"), { target: { value: "not-a-trace-id" } });
  fireEvent.click(screen.getByRole("button", { name: "查找调用" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/32 位/);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([[404, /未找到该调用/], [403, /权限已失效/]] as const)("handles Trace ID lookup status %s explicitly", async (status, message) => {
  show(); await screen.findByText(/暂无调用记录/);
  fetcher.mockResolvedValue(new Response("{}", { status }));
  fireEvent.change(screen.getByLabelText("Trace ID"), { target: { value: trace.trace_id } });
  fireEvent.click(screen.getByRole("button", { name: "查找调用" }));
  expect(await screen.findByText(message)).toBeVisible();
});
