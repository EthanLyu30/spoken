import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAuth } from "../store/auth";
import Admin from "./Admin";

vi.mock("../components/EChart", () => ({ EChart: () => null }));
const overview = { source: "server", count: 0, success_rate: null, errors: 0, timeouts: 0, cancelled: 0,
  latency: { p50: null, p95: null, p99: null }, ttft: { p50: null, p95: null, p99: null },
  input_tokens: null, output_tokens: null, usage_known: 0, operations: [], trend: [],
  facets: { operations: ["POST /api/chat/stream", "POST /api/interview/score"], models: [], releases: [] },
  collection: { active: true, retention_days: 14, max_records: 20000, oldest_at: null, dropped_since_restart: 0, write_errors_since_restart: 0 } };
const user = { id: 7, email: "owner@example.com", display_name: "Owner", avatar_url: "", created_at: "2026-10-30", is_admin: true };
const trace = { trace_id: "a".repeat(32), started_at: "2026-10-30T02:00:00Z", source: "server", operation: "POST /api/chat/stream", outcome: "ok", duration_ms: 1200, ttft_ms: 250, model: "deepseek-flash", input_tokens: 20, output_tokens: 10, release: "qa", spans: [{ id: "b".repeat(16), parent_id: null, name: "deepseek.stream", offset_ms: 50, duration_ms: 1100, outcome: "ok", attributes: { provider: "deepseek" } }] };
const fetcher = vi.fn();
function show() { return render(<MemoryRouter><Admin /></MemoryRouter>); }
beforeEach(() => {
  useAuth.setState({ user });
  fetcher.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("/overview") ? overview : url.includes(`/traces/${trace.trace_id}`) ? trace : { items: [], total: 0 }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllGlobals(); fetcher.mockReset(); useAuth.setState({ user: null }); });

it("does not load private data for guests or ordinary accounts", () => {
  useAuth.setState({ user: { ...user, is_admin: false } });
  show();
  expect(screen.getByText(/仅管理员/)).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
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
