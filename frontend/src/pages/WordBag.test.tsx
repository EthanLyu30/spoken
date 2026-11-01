import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import WordBag from "./WordBag";
import { useWords } from "../store/words";
vi.mock("../lib/speech", () => ({ speakText: vi.fn() }));
const collect = vi.fn();
const review = vi.fn();
beforeEach(() => {
  collect.mockReset();
  review.mockReset();
  useWords.setState({
    words: [],
    fetchedOnce: true,
    error: false,
    ensureLoaded: vi.fn(),
    collect,
    review,
  });
});

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

it("excludes unsaved words from the review deck", async () => {
  useWords.setState({words:[{id:-1,text:"saving",meaning:"",example:"",scenario_id:"",kind:"word",mastered:false,created_at:""}]});
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  expect(screen.getAllByRole("button",{name:"开始复习"}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
});

it("keeps a failed review on the same card and retries the original choice", async () => {
  let reject!: (error:Error)=>void;
  review.mockReturnValueOnce(new Promise<void>((_resolve,r)=>{reject=r;})).mockResolvedValueOnce(undefined);
  useWords.setState({words:[{id:1,text:"hello",meaning:"你好",example:"",scenario_id:"",kind:"word",mastered:false,created_at:""}]});
  const user=userEvent.setup();render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button",{name:"复习 1"}));
  await user.click(screen.getByRole("button",{name:/记得/}));
  expect(screen.queryByText("复习完成！")).not.toBeInTheDocument();
  await act(async()=>{reject(new Error("lost response"));});
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("button",{name:"忘了"})).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"重试保存"}));
  expect(screen.getByText("复习完成！")).toBeVisible();
  expect(review.mock.calls.slice(-2)).toEqual([[1,true],[1,true]]);
});


it("recovers the original choice when restarting a deck after an ambiguous save", async()=>{
  review.mockReset().mockRejectedValueOnce(Object.assign(new Error("retry original"),{remembered:true})).mockResolvedValueOnce(undefined);
  useWords.setState({words:[{id:1,text:"hello",meaning:"你好",example:"",scenario_id:"",kind:"word",mastered:false,created_at:""}]});
  const user=userEvent.setup();render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button",{name:"复习 1"}));await user.click(screen.getByRole("button",{name:"忘了"}));
  await user.click(screen.getByRole("button",{name:"重试保存"}));
  expect(review.mock.calls).toEqual([[1,false],[1,true]]);expect(screen.getByText("记得 1 · 待加强 0")).toBeVisible();
});
