import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getPractice: vi.fn().mockResolvedValue([]), getSessions: vi.fn().mockResolvedValue([]), getStats: vi.fn().mockResolvedValue(null) }));
vi.mock("../lib/api", async (load) => ({ ...await load<object>(), ...mocks }));
vi.mock("../components/EChart", () => ({ EChart: () => null }));
vi.mock("../lib/speech", () => ({ listBrowserVoices: () => [], primeBrowserVoices: vi.fn(), speakText: vi.fn() }));
import Profile from "./Profile";

it("keeps the settings link and all three voice engines on the separate settings tab", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/me?tab=voice"]}><Profile /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: "让声音，适合你的节奏。" })).toBeVisible();
  expect(screen.getByRole("button", { name: /云端语音/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /设备语音/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /本地模型/ })).toBeVisible();
  expect(screen.getByRole("slider", { name: "朗读语速" })).toBeVisible();
  expect(screen.getByRole("slider", { name: "朗读音调" })).toBeVisible();
  await user.click(screen.getByRole("link", { name: "资料与成就" }));
  expect(screen.getByRole("heading", { name: "成就徽章" })).toBeVisible();
  expect(screen.getByText("升级达人")).toBeVisible();
});
