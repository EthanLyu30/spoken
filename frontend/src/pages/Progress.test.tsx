import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import type { PracticeRecord } from "../lib/api";

const mock = vi.hoisted(() => ({ records: [] as PracticeRecord[] }));
vi.mock("../hooks/useProgressData", () => ({ useProgressData: () => ({
  sessions: [], practice: mock.records, stats: null, insights: null, latest: null,
  status: "ready", errors: [], practicePending: false, statsPending: false, reload: vi.fn(),
}) }));
vi.mock("../components/EChart", () => ({ EChart: () => null }));
import Progress from "./Progress";

const record = (id: number, score: number, score_max?: number): PracticeRecord => ({
  id, kind: "interview", score, score_max, title: `访谈记录${id}`, created_at: "2026-10-30T02:00:00Z",
});
function show() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Progress /></MemoryRouter>);
}
beforeEach(() => { mock.records = []; });

it("shows mixed history in native scales while averaging only the new rubric", () => {
  mock.records = [record(1, 6), record(2, 3, 5), record(3, 5, 5)];
  show();
  const metric = screen.getByText("近期访谈内容均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4")).toBeVisible();
  expect(within(metric).getByText("/ 5")).toBeVisible();
  expect(within(metric).getByText(/旧版 1 次未混入/)).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录1/ })).getByText("/ 6")).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录2/ })).getByText("/ 5")).toBeVisible();
});

it("keeps an all-legacy average explicitly labelled six-point", () => {
  mock.records = [record(1, 6), record(2, 3)];
  show();
  const metric = screen.getByText("旧版访谈均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4.5")).toBeVisible();
  expect(within(metric).getByText("/ 6")).toBeVisible();
});
