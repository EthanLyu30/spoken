import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getInterviewSets: vi.fn(), begin: vi.fn() }));
vi.mock("../lib/api", async (original) => ({
  ...await original<typeof import("../lib/api")>(),
  getInterviewSets: mocks.getInterviewSets,
}));
vi.mock("../hooks/useInterviewSession", () => ({
  useInterviewSession: () => ({ phase: "intro", begin: mocks.begin }),
}));
import Interview from "./Interview";

const catalogue = [
  ...Array.from({ length: 190 }, (_, i) => ({
    id: `inspire-${i + 1}`,
    episode: i + 1,
    collection: "inspire",
    topic: i === 189 ? "写作与表达" : `系列主题${i + 1}`,
    topic_en: i === 189 ? "Writing and expression" : `Series topic ${i + 1}`,
    intro: "Four connected interview questions.",
    question_count: 4,
    source_title: `Inspire SpeakEasy #${i + 1}`,
    source_url: `https://www.youtube.com/watch?v=episode${i + 1}`,
    source_kind: "video_adapted",
    reviewed_at: "2026-10-28",
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `ets-${i + 1}`,
    episode: null,
    collection: "ets",
    topic: `ETS主题${i + 1}`,
    topic_en: `ETS topic ${i + 1}`,
    intro: "Four connected interview questions.",
    question_count: 4,
    source_title: `ETS sample ${i + 1}`,
    source_url: "https://www.ets.org/example",
    source_kind: "official_adapted",
    reviewed_at: "2026-10-28",
  })),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getInterviewSets.mockResolvedValue(catalogue);
});

async function setup() {
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
  await screen.findByText("Series topic 1");
  return user;
}

it("shows six of the selected source's groups per page and keeps the last page reachable", async () => {
  const user = await setup();
  const topics = screen.getByRole("group", { name: "选择访谈主题" });
  expect(within(topics).getAllByRole("button")).toHaveLength(7);
  expect(screen.getByRole("button", { name: /博主系列.*190/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: /ETS主题/ })).not.toBeInTheDocument();
  expect(screen.getByText("第 1 / 32 页")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByRole("button", { name: /系列主题7.*Series topic 7/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /系列主题1(?!\d).*Series topic 1(?!\d)/ })).not.toBeInTheDocument();
  const nextPage = screen.getByRole("button", { name: "下一页" });
  for (let page = 2; page < 32; page++) fireEvent.click(nextPage);
  expect(screen.getByRole("button", { name: /写作与表达.*Writing and expression/ })).toBeInTheDocument();
  expect(within(topics).getAllByRole("button")).toHaveLength(5);
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
});

it("searches Chinese and English topics and exact episode numbers, and clears hidden selections", async () => {
  const user = await setup();
  const search = screen.getByRole("searchbox", { name: "搜索访谈主题或期数" });
  await user.click(screen.getByRole("button", { name: /系列主题1(?!\d).*Series topic 1(?!\d)/ }));
  await user.type(search, "写作");
  const writing = screen.getByRole("button", { name: /写作与表达.*Writing and expression/ });
  expect(screen.getByRole("button", { name: /随机一组/ })).toHaveAttribute("aria-pressed", "true");
  await user.click(writing);
  await user.clear(search);
  await user.type(search, "WRITING");
  expect(screen.getByRole("button", { name: /写作与表达.*Writing and expression/ })).toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "#19");
  expect(screen.getByRole("button", { name: /系列主题19.*Series topic 19/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /写作与表达.*Writing and expression/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /随机一组/ })).toHaveAttribute("aria-pressed", "true");
  await user.type(search, "0");
  expect(screen.getByRole("button", { name: /写作与表达.*Writing and expression/ })).toBeInTheDocument();
});

it("clears a selected group when paging away and starts a random group from the current source", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: /系列主题1(?!\d).*Series topic 1(?!\d)/ }));
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await user.click(screen.getByRole("button", { name: "开始这组练习" }));
  expect(mocks.begin).toHaveBeenLastCalledWith("practice", undefined, "inspire");
  await user.click(screen.getByRole("button", { name: /ETS 公开样题.*5/ }));
  expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /ETS主题1.*ETS topic 1/ }));
  await user.click(screen.getByRole("button", { name: /博主系列.*190/ }));
  await user.click(screen.getByRole("button", { name: "开始练习" }));
  expect(mocks.begin).toHaveBeenLastCalledWith("practice", undefined, "inspire");
});

it("uses the selected source for both modes and allows random starts after an empty search", async () => {
  const user = await setup();
  await user.click(screen.getByRole("button", { name: /ETS 公开样题.*5/ }));
  await user.click(screen.getByRole("button", { name: /ETS主题2.*ETS topic 2/ }));
  await user.click(screen.getByRole("button", { name: "开始这组练习" }));
  expect(mocks.begin).toHaveBeenLastCalledWith("practice", "ets-2", "ets");
  await user.click(screen.getByRole("button", { name: /模拟模式/ }));
  await user.click(screen.getByRole("button", { name: "开始模拟访谈" }));
  expect(mocks.begin).toHaveBeenLastCalledWith("simulation", "ets-2", "ets");
  await user.type(screen.getByRole("searchbox", { name: "搜索访谈主题或期数" }), "不存在的主题");
  expect(screen.getByText(/没有找到匹配的主题/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "开始模拟" }));
  expect(mocks.begin).toHaveBeenLastCalledWith("simulation", undefined, "ets");
  await user.click(screen.getByRole("button", { name: "清除搜索" }));
  expect(screen.getByRole("button", { name: /ETS主题1.*ETS topic 1/ })).toBeInTheDocument();
});

it("uses actual imported counts and offers a source switch when a collection is empty", async () => {
  mocks.getInterviewSets.mockResolvedValue(catalogue.slice(190));
  const user = userEvent.setup();
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Interview /></MemoryRouter>);
  await screen.findByRole("button", { name: /ETS 公开样题.*5/ });
  expect(screen.getByRole("button", { name: /博主系列.*0/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始练习" })).toBeDisabled();
  expect(screen.getByText(/这一来源暂无可用题组/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "切换到 ETS 公开样题" }));
  expect(screen.getByRole("button", { name: "开始这组练习" })).toBeEnabled();
  await user.click(screen.getByText("系列收录说明"));
  expect(screen.getByText(/博主系列已收录 0 组，ETS 公开样题 5 组/)).toBeInTheDocument();
});
