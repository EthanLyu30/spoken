import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { WordBagFilters } from "./WordBagFilters";

it("shows the available topics when refresh removes the need for a search field", async () => {
  const topics = ["咖啡馆", "机场", "酒店", "面试", "商务", "问路", "购物"];
  const props = { topic: "", familiarity: "", mode: "translate" as const, onTopic: vi.fn(), onFamiliarity: vi.fn(), onMode: vi.fn() };
  const user = userEvent.setup();
  const view = render(<WordBagFilters {...props} topics={topics} />);
  await user.click(screen.getByRole("button", { name: "筛选与题型" }));
  await user.type(screen.getByRole("textbox", { name: "查找话题" }), "购物");
  expect(screen.queryByRole("button", { name: "机场" })).not.toBeInTheDocument();

  view.rerender(<WordBagFilters {...props} topics={topics.slice(0, 6)} />);
  expect(screen.queryByRole("textbox", { name: "查找话题" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "机场" }));
  expect(props.onTopic).toHaveBeenCalledExactlyOnceWith("机场");
});
