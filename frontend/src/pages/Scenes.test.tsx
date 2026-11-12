import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { chapters, scenarios } from "../data/scenarios";
import Scenes from "./Scenes";

it("retains every catalogue scene across chapter changes and keeps custom scenes reachable", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><Scenes /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "自定义场景" })).toHaveAttribute("href", "/custom");
  for (const chapter of chapters) {
    await user.click(screen.getByRole("button", { name: chapter.titleZh }));
    for (const id of chapter.ids) {
      expect(screen.getByRole("link", { name: new RegExp(scenarios.find((s) => s.id === id)!.titleZh) })).toHaveAttribute("href", `/practice/${id}`);
    }
  }
  const grouped = new Set(chapters.flatMap((c) => c.ids));
  for (const scene of scenarios.filter((s) => !grouped.has(s.id))) {
    expect(screen.getByRole("link", { name: new RegExp(scene.titleZh) })).toHaveAttribute("href", `/practice/${scene.id}`);
  }
});

it("identifies the active chapter and exposes its updated list to assistive technology", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><Scenes /></MemoryRouter>);
  const chapter = chapters[1];
  const control = screen.getByRole("button", { name: chapter.titleZh });
  control.focus();
  await user.keyboard("{Enter}");
  expect(control).toHaveFocus();
  expect(control).toHaveAttribute("aria-pressed", "true");
  const list = screen.getByRole("region", { name: `${chapter.titleZh}闯关地图` });
  expect(control).toHaveAttribute("aria-controls", list.id);
  expect(screen.getByRole("status")).toHaveTextContent(`${chapter.titleZh} · ${chapter.ids.length} 关`);
});
