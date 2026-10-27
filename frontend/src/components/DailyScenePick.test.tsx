import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getScenarioSuggestion: vi.fn() }));
vi.mock("../lib/api", () => mocks);
import { DailyScenePick } from "./DailyScenePick";
import { useCustomScene } from "../store/custom";
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

it("lets a failed recommendation retry, refreshes with fresh=true and starts the returned scene", async () => {
  const scene = { title: "New scene", title_zh: "新推荐", goal: "Ask for help", role: "neighbor", opening_line: "Hi" };
  mocks.getScenarioSuggestion.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(scene);
  const user = userEvent.setup();
  render(<MemoryRouter><Routes><Route path="/" element={<DailyScenePick />} /><Route path="/practice/custom" element={<p>已进入练习</p>} /></Routes></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "重试推荐" }));
  await screen.findByText("新推荐");
  await user.click(screen.getByRole("button", { name: "换一个" }));
  expect(mocks.getScenarioSuggestion).toHaveBeenLastCalledWith(true, undefined);
  await user.click(screen.getByRole("button", { name: "去练这个" }));
  await screen.findByText("已进入练习");
  expect(useCustomScene.getState().scene).toEqual(scene);
});
