import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import WordBag from "./WordBag";
import { useWords } from "../store/words";
vi.mock("../lib/speech", () => ({ speakText: vi.fn() }));
const collect = vi.fn();
const review = vi.fn();
beforeEach(() =>
  useWords.setState({
    words: [],
    fetchedOnce: true,
    error: false,
    ensureLoaded: vi.fn(),
    collect,
    review,
  }),
);

it("allows the first word to be added to an empty bag", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <WordBag />
    </MemoryRouter>,
  );
  await user.type(
    screen.getByRole("textbox", { name: "添加单词" }),
    "recommend{Enter}",
  );
  expect(collect).toHaveBeenCalledWith({ text: "recommend", kind: "word" });
});

it("reviews due words and keeps remember/forget and completion reachable", async () => {
  useWords.setState({
    words: [
      {
        id: 1,
        text: "recommend",
        meaning: "推荐",
        example: "I recommend it.",
        scenario_id: "cafe",
        mastered: false,
        kind: "word",
        created_at: "2026-10-01",
        box: 0,
        due_at: null,
      },
    ],
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <WordBag />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "复习 1" }));
  await user.click(screen.getByRole("button", { name: "recommend" }));
  expect(screen.getByText("推荐")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /记得/ }));
  expect(review).toHaveBeenCalledWith(1, true);
  expect(screen.getByText("复习完成！")).toBeVisible();
});

it("starts a fresh review deck from its first card when restarted from the sidebar", async () => {
  const base = {
    meaning: "含义",
    example: "",
    scenario_id: "cafe",
    mastered: false,
    kind: "word",
    created_at: "",
    due_at: null,
  };
  useWords.setState({
    words: [
      { ...base, id: 1, text: "first" },
      { ...base, id: 2, text: "second" },
    ],
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <WordBag />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "复习 2" }));
  await user.click(screen.getByRole("button", { name: /记得/ }));
  useWords.setState({
    words: [
      { ...base, id: 1, text: "first", due_at: "2099-01-01" },
      { ...base, id: 2, text: "second" },
    ],
  });
  await user.click(screen.getByRole("button", { name: "开始复习" }));
  expect(screen.getByRole("button", { name: "second" })).toBeVisible();
  expect(screen.getByText("1 / 1")).toBeVisible();
});
