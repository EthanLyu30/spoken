import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { AppHeader } from "./AppHeader";

it("keeps scene, interview and progress reachable and opens learning tools by keyboard", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AppHeader /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "场景练习" })).toHaveAttribute("href", "/scenes");
  expect(screen.getByRole("link", { name: "Take an Interview" })).toHaveAttribute("href", "/interview");
  expect(screen.getByRole("link", { name: "学习进度" })).toHaveAttribute("href", "/progress");
  const tools = screen.getByRole("button", { name: "学习工具" });
  await user.click(tools);
  expect(screen.getByRole("link", { name: "生词本" })).toHaveAttribute("href", "/words");
  expect(screen.getByRole("link", { name: "每日金句" })).toHaveAttribute("href", "/daily");
  await user.keyboard("{Escape}");
  expect(tools).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("link", { name: "每日金句" })).not.toBeInTheDocument();
});
