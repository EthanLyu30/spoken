import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("aborts in-flight reads and hides private results on logout", async () => {
  show();
  await screen.findByText(/暂无调用记录/);
  const signals = fetcher.mock.calls.map(([, options]) => options.signal as AbortSignal);
  act(() => useAuth.setState({ user: null }));
  expect(screen.getByText(/仅管理员/)).toBeVisible();
  expect(signals.every(signal => signal.aborted)).toBe(true);
});
