import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import Home from "./Home";

const loaded = vi.hoisted(() => ({ prep: vi.fn(), conversation: vi.fn() }));
vi.mock("./PracticePrep", () => { loaded.prep(); return { default: () => null }; });
vi.mock("./Conversation", () => { loaded.conversation(); return { default: () => null }; });
vi.mock("../components/DailyScenePick", () => ({ DailyScenePick: () => null }));
vi.mock("../components/DailyGoal", () => ({ DailyGoal: () => null }));
vi.mock("../components/BackendStatus", () => ({ BackendStatus: () => null }));
vi.mock("../components/FeedbackEntry", () => ({ PipFeedbackBubble: () => null }));

it("preloads the prep page linked by the main practice button", async () => {
  render(<MemoryRouter><Home /></MemoryRouter>);
  const link = screen.getByRole("link", { name: "开始语音练习" });
  expect(link).toHaveAttribute("href", "/prepare/cafe");
  try {
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    fireEvent.focus(link);
    await vi.dynamicImportSettled();
    expect(loaded.prep).not.toHaveBeenCalled();
    expect(loaded.conversation).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
  fireEvent.focus(link);
  await vi.dynamicImportSettled();
  expect(loaded.prep).toHaveBeenCalledOnce();
  expect(loaded.conversation).not.toHaveBeenCalled();
});
