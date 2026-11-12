import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { getAdminOverview, type AdminOverview } from "../lib/adminApi";
import { useAuth } from "../store/auth";
import Admin from "./Admin";

vi.mock("../components/EChart", () => ({ EChart: () => null }));
vi.mock("../lib/adminApi", async (original) => ({
  ...await original<typeof import("../lib/adminApi")>(),
  getAdminOverview: vi.fn(),
  getAdminTraces: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
afterEach(() => useAuth.setState({ user: null }));

it("updates the hourly latency table with the operation filter and preserves missing P95 values", async () => {
  const time = "2026-11-12T08:00:00Z";
  const overview: AdminOverview = {
    source: "server", count: 6, success_rate: 1, errors: 0, timeouts: 0, cancelled: 1,
    latency: { p50: 500, p95: 1234.5, p99: 1300 }, ttft: { p50: null, p95: null, p99: null },
    input_tokens: null, output_tokens: null, usage_known: 0,
    operations: ["POST /api/chat/stream", "POST /api/interview/score"],
    trend: [
      { time, operation: "POST /api/chat/stream", count: 5, p95: 1234.5 },
      { time, operation: "POST /api/interview/score", count: 1, p95: null },
    ],
    collection: { active: true, retention_days: 14, max_records: 20000, oldest_at: null, dropped_since_restart: 0, write_errors_since_restart: 0 },
  };
  vi.mocked(getAdminOverview).mockImplementation(async ({ operation }) => ({
    ...overview,
    trend: overview.trend.filter(point => !operation || point.operation === operation),
  }));
  useAuth.setState({ user: { id: 7, email: "owner@example.test", display_name: "Owner", avatar_url: "", created_at: time, is_admin: true } });
  render(<MemoryRouter initialEntries={["/admin?view=diagnostics"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Admin /></MemoryRouter>);

  fireEvent.click(await screen.findByText("查看每小时耗时数据", { selector: "summary" }));
  const tableName = "每小时耗时趋势（北京时间）";
  const table = await screen.findByRole("table", { name: tableName });
  expect(within(table).getByRole("cell", { name: "1,234.5" })).toBeVisible();
  expect(within(table).getByRole("cell", { name: "无数据" })).toBeVisible();

  fireEvent.change(screen.getByLabelText("业务操作"), { target: { value: "POST /api/interview/score" } });
  await waitFor(() => {
    const filtered = screen.getByRole("table", { name: tableName });
    expect(within(filtered).getAllByRole("row")).toHaveLength(2);
    expect(within(filtered).getByRole("cell", { name: "无数据" })).toBeVisible();
  });
});
