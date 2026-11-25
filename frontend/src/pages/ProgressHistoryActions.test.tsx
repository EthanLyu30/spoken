import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PracticeRecord, SessionSummary } from "../lib/api";
import { clearToken, setToken } from "../lib/authToken";
import { invalidateProgress } from "../lib/progressCache";
import * as sessionSave from "../lib/sessionSave";
import { useAuth } from "../store/auth";
import Progress from "./Progress";

vi.mock("../components/EChart", () => ({ EChart: () => null }));

const airport = { id: 7, scenario_id: "airport", overall: 80, created_at: "2026-11-04T12:00:00.123456+08:00" };
const cafe = { id: 8, scenario_id: "cafe", overall: 60, created_at: "2026-11-03T12:00:00Z" };
const interview = { id: 7, kind: "interview", score: 4, score_max: 5, title: "主题访谈示例", created_at: airport.created_at };
const pronunciation = { id: 8, kind: "pronunciation", score: 85, title: "机场跟读示例", created_at: cafe.created_at };
const person = (id: number) => ({ id, email: `person-${id}@example.test`, display_name: "", avatar_url: "", created_at: "" });
const stats = (total_sessions: number, total_practice: number) => ({
  streak_days: 1, today_count: 1, today_goal: 3, level: 1, xp: 20, xp_to_next: 100, total_sessions, total_practice, words_count: 0,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(sessions: SessionSummary[] = [airport, cafe], practice: PracticeRecord[] = [interview, pronunciation]) {
  const response = (body: unknown) => Response.json(body);
  const fixture = {
    sessions, practice, staleStats: null as Promise<Response> | null,
    staleSessions: null as Promise<Response> | null,
  };
  const remove = vi.fn<(url: URL, request: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 204 }));
  const fetcher = vi.fn((raw: string, request: RequestInit) => {
    const url = new URL(raw, "http://spoken.test");
    if (request.method === "DELETE") return remove(url, request);
    if (url.pathname === "/api/stats") return fixture.staleStats ?? Promise.resolve(response(stats(fixture.sessions.length, fixture.practice.length)));
    if (url.pathname === "/api/progress/sessions") return fixture.staleSessions ?? Promise.resolve(response({
      sessions: fixture.sessions, insights: { available: false }, latest: fixture.sessions.length ? {
        id: fixture.sessions[0].id, scores: [{ key: "fluency", label_zh: "流利度", score: fixture.sessions[0].overall }],
      } : null,
    }));
    if (url.pathname === "/api/practice") return Promise.resolve(response(fixture.practice));
    if (url.pathname === "/api/progress/coaching") return Promise.resolve(response({ revision: "empty", examples: [], patterns: [] }));
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Progress /></MemoryRouter>);
  return { fixture, remove, fetcher };
}

beforeEach(() => {
  invalidateProgress();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  clearToken();
  useAuth.setState({ user: null });
  vi.unstubAllGlobals();
  invalidateProgress();
});

async function openConfirmation(title: string) {
  const more = await screen.findByRole("button", { name: new RegExp(`${title}.*更多`) });
  await userEvent.click(more);
  await userEvent.click(screen.getByRole("menuitem", { name: "删除这次练习" }));
  return screen.getByRole("alertdialog", { name: "删除这次练习？" });
}

it("opens the menu with a keyboard, defaults to cancel, and restores focus on Escape or cancellation", async () => {
  const { remove } = setup();
  const link = await screen.findByRole("link", { name: /机场值机/ });
  const destination = new URL(link.getAttribute("href")!, "https://spoken.test");
  expect(destination.pathname).toBe("/session/7");
  expect(destination.searchParams.get("created_at")).toBe(airport.created_at);
  const more = screen.getByRole("button", { name: /机场值机.*更多/ });
  expect(link).not.toContainElement(more);
  more.focus();
  await userEvent.keyboard("{ArrowDown}");
  const item = screen.getByRole("menuitem", { name: "删除这次练习" });
  expect(item).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(item).not.toBeInTheDocument();
  expect(more).toHaveFocus();

  await userEvent.keyboard("{Enter}{Enter}");
  const dialog = screen.getByRole("alertdialog", { name: "删除这次练习？" });
  expect(dialog).toHaveTextContent("机场值机");
  expect(dialog.querySelector("time")).toHaveAttribute("datetime", airport.created_at);
  expect(dialog.querySelector("time")).toHaveTextContent("2026");
  expect(dialog).toHaveTextContent(/练习统计.*收藏.*奖励/);
  expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog).not.toBeInTheDocument();
  expect(more).toHaveFocus();

  const again = await openConfirmation("机场值机");
  await userEvent.click(within(again).getByRole("button", { name: "取消" }));
  expect(more).toHaveFocus();
  expect(remove).not.toHaveBeenCalled();
});

it("deletes the exact scene once, immediately refreshes derived history, and waits for updated aggregates", async () => {
  const forgetSavedSession = vi.spyOn(sessionSave, "forgetSavedSession");
  setToken("history-owner-token");
  useAuth.setState({ user: person(23) });
  const { fixture, fetcher, remove } = setup();
  const pendingDelete = deferred<Response>();
  const pendingStats = deferred<Response>();
  const pendingSessions = deferred<Response>();
  remove.mockReturnValueOnce(pendingDelete.promise);
  const overview = screen.getByRole("region", { name: "学习概览" });
  const dialog = await openConfirmation("机场值机");
  expect(within(overview).getByText("2 次场景 · 2 次专项")).toBeVisible();
  expect(within(overview).getByText("70")).toBeVisible();
  const confirm = within(dialog).getByRole("button", { name: "确认删除" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole("status")).toHaveTextContent("正在删除…");
  expect(remove).toHaveBeenCalledTimes(1);
  const [url, request] = remove.mock.calls[0];
  expect(url.pathname).toBe("/api/sessions/7");
  expect(url.searchParams.get("created_at")).toBe(airport.created_at);
  expect(new Headers(request.headers).get("Authorization")).toBe("Bearer history-owner-token");

  fixture.sessions = [cafe];
  fixture.staleStats = pendingStats.promise;
  fixture.staleSessions = pendingSessions.promise;
  await act(async () => pendingDelete.resolve(new Response(null, { status: 204 })));
  expect(forgetSavedSession).toHaveBeenCalledWith(airport.id, airport.created_at);
  expect(screen.queryByRole("link", { name: /机场值机/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /主题访谈示例.*更多/ })).toBeVisible();
  expect(screen.queryByText("查看最近一次能力雷达")).not.toBeInTheDocument();
  expect(within(overview).getByText("60")).toBeVisible();
  expect(within(overview).queryByText("2 次场景 · 2 次专项")).not.toBeInTheDocument();
  expect(screen.getByText("已删除这次练习。")).toBeVisible();
  expect(screen.getByRole("heading", { name: "回看走过的每一步" })).toHaveFocus();
  await act(async () => {
    pendingStats.resolve(Response.json(stats(1, 2)));
    pendingSessions.resolve(Response.json({ sessions: [cafe], insights: { available: false }, latest: null }));
  });
  expect(await within(overview).findByText("1 次场景 · 2 次专项")).toBeVisible();
  expect(fetcher.mock.calls.filter(([path]) => path === "/api/stats")).toHaveLength(2);
});

it.each([interview, pronunciation])("deletes a $kind under the practice endpoint", async (row) => {
  const { fixture, remove } = setup();
  const dialog = await openConfirmation(row.title);
  fixture.practice = fixture.practice.filter((entry) => entry !== row);
  await userEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  await screen.findByText("已删除这次练习。");
  const [url] = remove.mock.calls[0];
  expect(url.pathname).toBe(`/api/practice/${row.id}`);
  expect(url.searchParams.get("created_at")).toBe(row.created_at);
  expect(screen.queryByRole("button", { name: new RegExp(`${row.title}.*更多`) })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /机场值机/ })).toBeVisible();
});

it("keeps the last unscored scene deleted even if refreshing history fails", async () => {
  const { fixture } = setup([{ ...airport, overall: null }], []);
  const dialog = await openConfirmation("机场值机");
  expect(screen.getByRole("link", { name: /机场值机.*未评分/ })).toBeInTheDocument();
  fixture.sessions = [];
  fixture.staleSessions = Promise.resolve(Response.json({ detail: "offline" }, { status: 503 }));
  await userEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("已删除这次练习。")).toBeVisible();
  expect(await screen.findByRole("heading", { name: "学习记录加载失败" })).toBeVisible();
  expect(screen.queryByRole("link", { name: /机场值机/ })).not.toBeInTheDocument();
  fixture.staleSessions = null;
  await userEvent.click(screen.getByRole("button", { name: "重试加载记录" }));
  expect(await screen.findByText("这里，等你的第一次开口。")).toBeVisible();
});

it("keeps a row and allows retry after a transient failure", async () => {
  const { fixture, remove } = setup();
  remove.mockRejectedValueOnce(new Error("offline"));
  const dialog = await openConfirmation("机场值机");
  const confirm = within(dialog).getByRole("button", { name: "确认删除" });
  await userEvent.click(confirm);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("暂时无法删除，请重试。");
  expect(confirm).not.toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("link", { name: /机场值机/ })).toBeInTheDocument();
  fixture.sessions = [cafe];
  await userEvent.click(confirm);
  expect(await screen.findByText("已删除这次练习。")).toBeVisible();
  expect(remove).toHaveBeenCalledTimes(2);
});

it.each([404, 409])("refreshes after a stale %s and never deletes a replacement with the same id", async (status) => {
  const { fixture, remove } = setup();
  remove.mockResolvedValueOnce(Response.json({ detail: "record unavailable" }, { status }));
  const dialog = await openConfirmation("机场值机");
  fixture.sessions = [{ ...airport, scenario_id: "hotel", created_at: "2026-11-10T16:00:00Z" }, cafe];
  await userEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  expect(await screen.findByText("这条练习已变更或无法访问。")).toBeVisible();
  expect(await screen.findByRole("link", { name: /酒店入住/ })).toBeVisible();
  expect(screen.queryByRole("link", { name: /机场值机/ })).not.toBeInTheDocument();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("aborts the old owner's request and disregards a late result after an account change", async () => {
  const forgetSavedSession = vi.spyOn(sessionSave, "forgetSavedSession");
  setToken("history-old-owner");
  useAuth.setState({ user: person(23) });
  const { remove } = setup();
  const pending = deferred<Response>();
  remove.mockReturnValueOnce(pending.promise);
  const dialog = await openConfirmation("机场值机");
  await userEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  act(() => { setToken("history-next-owner"); useAuth.setState({ user: person(42) }); });
  expect(remove.mock.calls[0][1].signal?.aborted).toBe(true);
  expect(dialog).not.toBeInTheDocument();
  await act(async () => pending.resolve(new Response(null, { status: 204 })));
  expect(forgetSavedSession).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByRole("link", { name: /机场值机/ })).toBeVisible());
  expect(screen.queryByText("已删除这次练习。")).not.toBeInTheDocument();
});
