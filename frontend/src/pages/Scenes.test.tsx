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
