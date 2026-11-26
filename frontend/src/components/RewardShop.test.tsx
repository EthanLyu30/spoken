import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PracticeRewards } from "./PracticeRewards";
import RewardShop from "../pages/RewardShop";
import { invalidateGuestIdentity } from "../lib/authToken";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../lib/api", async load => ({ ...(await load<object>()), request }));

function freshWallet() {
  return {
    date: "2026-11-25", coins: 120, streak: 3, checked_in: false, goal_count: 3, goal_target: 3,
    goal_claimed: false, checkin_coins: 5, goal_coins: 15, wallpaper_price: 20, wallpaper_unlocked: false,
    items: [
      { id: "pip-scarf", price: 20, owned: false }, { id: "cafe-chime", price: 30, owned: false },
      { id: "cafe-rain", price: 80, owned: false },
    ],
    equipment: [] as string[], achievements: [{ id: "seven-days", count: 4, target: 7, earned: false }],
    weekly: { starts_on: "2026-11-23", ends_on: "2026-11-29", goals: [
      { id: "practice-days", count: 3, target: 3, coins: 20, claimed: false },
    ] },
  };
}
let wallet = freshWallet();
beforeEach(() => {
  wallet = freshWallet();
  request.mockReset().mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/equipment")) return [...wallet.equipment];
    if (path.endsWith("/items/pip-scarf") && init?.method === "POST") {
      wallet.items[0].owned = true; wallet.coins -= 20;
    } else if (path.endsWith("/items/pip-scarf") && init?.method === "PUT") {
      wallet.equipment = JSON.parse(String(init.body)).equipped ? ["pip-scarf"] : [];
    } else if (path.includes("/checkin?")) {
      wallet.checked_in = true; wallet.coins += 5; wallet.streak += 1;
    } else if (path.includes("/goal?")) {
      wallet.goal_claimed = true; wallet.coins += 15;
    } else if (path.includes("/weekly/practice-days?")) {
      wallet.weekly.goals[0].claimed = true; wallet.coins += 20;
    } else if (path.includes("/wallpaper?")) {
      wallet.wallpaper_unlocked = true; wallet.coins -= 20;
    }
    return structuredClone(wallet);
  });
});
afterEach(() => { cleanup(); invalidateGuestIdentity(); });

function openPage(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<PracticeRewards />} /><Route path="/me" element={<RewardShop />} />
  </Routes></MemoryRouter>);
}

it("keeps check-in, streak and daily claims on Home and opens a dedicated shop", async () => {
  const user = userEvent.setup();
  openPage("/");
  expect(screen.getByRole("heading", { name: "每日签到" })).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "签到 +5 金币" }));
  expect(await screen.findByRole("button", { name: "今日已签到" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "领目标奖 +15 金币" }));
  expect(await screen.findByText("140 金币")).toBeVisible();
  expect(screen.queryByText("围巾 Pip")).not.toBeInTheDocument();
  expect(screen.queryByText("奖励与纪念章")).not.toBeInTheDocument();
  const shop = screen.getByRole("link", { name: /逛商店/ });
  expect(shop).toHaveAttribute("href", "/me?tab=shop");
  await user.click(shop);
  expect(await screen.findByRole("heading", { name: "装扮商店" })).toBeVisible();
  expect(within(screen.getByRole("navigation", { name: "个人中心设置" })).getByRole("link", { name: "装扮商店" })).toHaveAttribute("aria-current", "page");
});

it("previews items without spending and lets owners redeem, equip and unequip from the shop", async () => {
  const user = userEvent.setup();
  openPage("/me?tab=shop");
  await user.click(await screen.findByRole("radio", { name: /咖啡馆门铃/ }));
  expect(screen.getByRole("button", { name: "试听门铃" })).toBeVisible();
  expect(wallet.coins).toBe(120);
  await user.click(screen.getByRole("radio", { name: /围巾 Pip/ }));
  await user.click(screen.getByRole("button", { name: "20 金币兑换围巾 Pip" }));
  await user.click(await screen.findByRole("button", { name: "使用围巾 Pip" }));
  expect(await screen.findByRole("button", { name: "停用围巾 Pip" })).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "已拥有" }));
  expect(screen.queryByRole("radio", { name: /咖啡馆门铃/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "停用围巾 Pip" }));
  expect(await screen.findByRole("button", { name: "使用围巾 Pip" })).toBeVisible();
  expect(wallet.coins).toBe(100);
});

it("keeps weekly rewards, medals and wallpaper usable after moving the catalog", async () => {
  const user = userEvent.setup();
  openPage("/me?tab=shop");
  await user.click(await screen.findByRole("button", { name: /练习满 3 天.*领 20 金币/ }));
  expect(await screen.findByRole("button", { name: /练习满 3 天.*已领取/ })).toBeDisabled();
  expect(screen.getByText("七日开口")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "20 金币兑换Pip 咖啡馆壁纸" }));
  expect(await screen.findByRole("link", { name: "下载壁纸" })).toHaveAttribute("download");
  expect(wallet.coins).toBe(120);
});

it("finishes a pending check-in after navigating to the shop and uses the resulting balance", async () => {
  const respond = request.getMockImplementation()!;
  let complete!: () => void;
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes("/checkin?")) await new Promise<void>(resolve => { complete = resolve; });
    return respond(path, init);
  });
  const user = userEvent.setup();
  openPage("/");
  await user.click(await screen.findByRole("button", { name: "签到 +5 金币" }));
  await user.click(screen.getByRole("link", { name: /逛商店/ }));
  expect(await screen.findByRole("button", { name: "20 金币兑换围巾 Pip" })).toBeDisabled();
  await act(async () => complete());
  expect(await screen.findByLabelText("余额 125 金币")).toBeVisible();
  expect(screen.getByRole("button", { name: "20 金币兑换围巾 Pip" })).toBeEnabled();
});

it("discards an old owner's late purchase response", async () => {
  const respond = request.getMockImplementation()!;
  let complete!: () => void;
  request.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.endsWith("/items/pip-scarf") && init?.method === "POST") {
      const result = await respond(path, init);
      await new Promise<void>(resolve => { complete = resolve; });
      return result;
    }
    return respond(path, init);
  });
  const user = userEvent.setup();
  openPage("/me?tab=shop");
  await user.click(await screen.findByRole("button", { name: "20 金币兑换围巾 Pip" }));
  wallet = { ...freshWallet(), coins: 1 };
  await act(async () => invalidateGuestIdentity());
  expect(await screen.findByLabelText("余额 1 金币")).toBeVisible();
  await act(async () => complete());
  expect(screen.getByLabelText("余额 1 金币")).toBeVisible();
  expect(screen.getByRole("button", { name: "20 金币兑换围巾 Pip" })).toBeDisabled();
});
