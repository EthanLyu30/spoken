import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getPractice: vi.fn().mockResolvedValue([]),
  getSessions: vi.fn().mockResolvedValue([]),
  getStats: vi.fn().mockResolvedValue(null),
}));
vi.mock("../lib/api", async (load) => ({
  ...(await load<object>()),
  ...mocks,
}));
vi.mock("../components/EChart", () => ({ EChart: ({ option }: { option: unknown }) => <pre data-testid="practice-chart">{JSON.stringify(option)}</pre> }));
vi.mock("../lib/speech", () => ({
  listBrowserVoices: () => [],
  primeBrowserVoices: vi.fn(),
  speakText: vi.fn(),
}));
import Profile from "./Profile";

it("keeps the settings link and all three voice engines on the separate settings tab", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/me?tab=voice"]}>
      <Profile />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "让声音，适合你的节奏。" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /云端语音/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /设备语音/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /本地模型/ })).toBeVisible();
  expect(screen.getByRole("slider", { name: "朗读语速" })).toBeVisible();
  expect(screen.getByRole("slider", { name: "朗读音调" })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "资料与成就" }));
  expect(
    await screen.findByRole("heading", { name: "成就徽章" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "查看全部徽章" }));
  expect(await screen.findByText("升级达人")).toBeVisible();
});

it("scrolls to badges after switching from the voice settings tab", async () => {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scroll,
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/me?tab=voice"]}>
      <Profile />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("link", { name: "成就徽章" }));
  await screen.findByRole("heading", { name: "成就徽章" });
  expect(scroll).toHaveBeenCalled();
});

it("keeps five-point and legacy six-point interview history on separate native axes", async () => {
  mocks.getPractice.mockResolvedValueOnce([
    { id: 1, kind: "interview", score: 5, score_max: 5, title: "new", created_at: "2026-10-30" },
    { id: 2, kind: "interview", score: 3, score_max: 5, title: "new", created_at: "2026-10-29" },
    { id: 3, kind: "interview", score: 6, title: "old", created_at: "2026-10-28" },
    { id: 4, kind: "interview", score: 4, title: "old", created_at: "2026-10-27" },
  ]);
  render(<MemoryRouter><Profile /></MemoryRouter>);
  expect(await screen.findByText(/访谈内容参考分 · \/5/)).toBeVisible();
  expect(screen.getByText(/旧版访谈参考分 · \/6/)).toBeVisible();
  const charts = screen.getAllByTestId("practice-chart").map((node) => JSON.parse(node.textContent ?? "{}"));
  expect(charts.find((chart) => chart.yAxis.max === 5).series[0].data).toEqual([3, 5]);
  expect(charts.find((chart) => chart.yAxis.max === 6).series[0].data).toEqual([4, 6]);
});
