import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import WordBag from "./WordBag";
import { useWords } from "../store/words";
vi.mock("../lib/speech", () => ({ speakText: vi.fn() }));
const collect = vi.fn();
const review = vi.fn();
const last_reviewed = "2026-10-01";
const modeLabels = { flip: "翻卡回忆", translate: "看中文写英文", cloze: "关键词填空" };
const rated = () => review.mock.calls.map(([word, choice]) => [word.id, choice]);

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("group", { name: "复习方式" })) await user.click(screen.getByRole("button", { name: /筛选与题型/ }));
}

async function pickMode(user: ReturnType<typeof userEvent.setup>, mode: keyof typeof modeLabels) {
  await openFilters(user);
  await user.click(within(screen.getByRole("group", { name: "复习方式" })).getByRole("button", { name: modeLabels[mode] }));
}

async function pickTopic(user: ReturnType<typeof userEvent.setup>, name: string) {
  await openFilters(user);
  await user.click(within(screen.getByRole("group", { name: "话题" })).getByRole("button", { name }));
}
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

it("teaches a new expression before recall and keeps it pending until its first rating is saved", async () => {
  const word = { id: 1, text: "layover", meaning: "转机停留", example: "I have a short layover.",
    scenario_id: "airport", kind: "word", mastered: false, created_at: "2026-11-25", due_at: "2026-11-25" };
  useWords.setState({ words: [word] });
  review.mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(async () => {
    useWords.setState({ words: [{ ...word, familiarity: "familiar", box: 1, last_reviewed: "2026-11-25", due_at: "2099-12-31" }] });
  });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "复习到期表达 0" })).toBeDisabled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  await openFilters(user);
  expect(screen.getByRole("group", { name: "熟悉度" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "学习新收藏 1" }));
  expect(screen.queryByRole("button", { name: /筛选与题型/ })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: word.text })).toBeVisible();
  expect(screen.getByText(word.example)).toBeVisible();
  expect(within(screen.getByRole("group", { name: "收藏来源" })).getByText("机场值机")).toBeVisible();
  expect(screen.getByRole("button", { name: "朗读" })).toBeVisible();
  expect(review).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "试着回忆" }));
  expect(screen.queryByText(word.text)).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "输入英文" }), "layover{Enter}");
  await user.click(screen.getByRole("button", { name: "熟悉（记得）" }));
  expect(await screen.findByRole("button", { name: "重试保存" })).toBeVisible();
  expect(screen.queryByText("学习完成！")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重试保存" }));
  expect(await screen.findByText("学习完成！")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "回到列表" }));
  expect(screen.getByRole("heading", { name: /把好表达/ })).toHaveFocus();
  expect(screen.getByRole("link", { name: "去场景里试试" })).toHaveAttribute("href", "/scenes");
  expect(screen.getByRole("button", { name: "学习新收藏 0" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "复习到期表达 0" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "提前复习 1" })).toBeEnabled();
});

it("uses recall and self-rating for a newly saved sentence without a usable translation or blank", async () => {
  useWords.setState({ words: [{ id: 2, text: "OK.", meaning: "", example: "OK.", scenario_id: "negotiation",
    kind: "sentence", mastered: false, created_at: "" }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "收藏句子 1" }));
  await pickMode(user, "cloze");
  await user.click(screen.getByRole("button", { name: "学习新收藏 1" }));
  expect(screen.getByRole("heading", { name: "OK." })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "试着回忆" }));
  expect(screen.queryByText("OK.")).not.toBeInTheDocument();
  expect(review).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "显示原文" }));
  await user.click(screen.getByRole("button", { name: "模糊" }));
  expect(await screen.findByText("学习完成！")).toBeVisible();
  expect(review).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 2, created_at: "" }), "uncertain", expect.any(String));
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
        last_reviewed,
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
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  await user.click(screen.getByRole("button", { name: "recommend" }));
  expect(screen.getByText("推荐")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /记得/ }));
  expect(rated()).toContainEqual([1, true]);
  expect(screen.getByText("复习完成！")).toBeVisible();
});

it("shows the original negotiation context before a translation and during immediate repetition", async () => {
  const sentence = "We could begin within a week of signing.";
  useWords.setState({ words: [{ id: 1, text: sentence, meaning: "我们可以在签署后一周内开始。",
    example: sentence, scenario_id: "negotiation", topic: "新话题", kind: "sentence", mastered: false, created_at: "", last_reviewed }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "收藏句子 1" }));
  await pickTopic(user, "新话题");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByText("商务谈判")).toBeVisible();
  expect(screen.getByText(/交期与条款/)).toBeVisible();
  expect(screen.queryByText(sentence)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看参考" }));
  await user.click(screen.getByRole("button", { name: "模糊" }));
  expect(screen.getByText("模糊巩固 · 第 2 / 2 遍")).toBeVisible();
  expect(screen.getByText("商务谈判")).toBeVisible();
  expect(screen.queryByText(sentence)).not.toBeInTheDocument();
});

it.each(["cloze", "flip"] as const)("shows the custom scene in %s and keeps the saved dialogue closed until reveal", async (mode) => {
  const sentence = "We could begin within a week of signing.";
  const previous = "What happens within a week of signing?";
  useWords.setState({ words: [{ id: 1, text: sentence, meaning: "我们可以在签署后一周内开始。", example: sentence,
    scenario_id: "custom", source: { key: `custom-${"a".repeat(64)}`, title: "项目交接", previous_partner_message: previous },
    topic: "个人分类", kind: "sentence", mastered: false, created_at: "", last_reviewed }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "收藏句子 1" }));
  await pickMode(user, mode);
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  const provenance = screen.getByRole("group", { name: "收藏来源" });
  expect(within(provenance).getByText("项目交接")).toBeVisible();
  expect(within(provenance).queryByText(previous)).not.toBeInTheDocument();
  if (mode === "cloze") {
    expect(screen.getByText("We could begin within a week of ____.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看参考" }));
  } else {
    await user.click(screen.getByRole("button", { name: sentence }));
  }
  expect(within(provenance).getByText(previous)).not.toBeVisible();
  await user.click(within(provenance).getByText("查看当时 Pip 的上一句"));
  expect(within(provenance).getByText(previous)).toBeVisible();
});

it("uses a topic label for manual entries and leaves unlabeled old entries alone", async () => {
  const base = { meaning: "各退一步", example: "Let's meet in the middle.", scenario_id: "", kind: "word", mastered: false, created_at: "", last_reviewed };
  useWords.setState({ words: [{ ...base, id: 1, text: "meet in the middle", topic: "谈价格" },
    { ...base, id: 2, text: "meet halfway" }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "复习到期表达 2" }));
  const provenance = screen.getByRole("group", { name: "收藏来源" });
  expect(provenance).toHaveTextContent("话题");
  expect(provenance).toHaveTextContent("谈价格");
  expect(within(provenance).queryByText("场景")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看参考" }));
  await user.click(screen.getByRole("button", { name: "熟悉（记得）" }));
  expect(screen.queryByRole("group", { name: "收藏来源" })).not.toBeInTheDocument();
});

it("starts a fresh review deck from the current due group after returning to the list", async () => {
  const base = {
    meaning: "含义",
    example: "",
    scenario_id: "cafe",
    mastered: false,
    kind: "word",
    created_at: "",
    due_at: null,
    last_reviewed,
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
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button", { name: "复习到期表达 2" }));
  await user.click(screen.getByRole("button", { name: /记得/ }));
  useWords.setState({
    words: [
      { ...base, id: 1, text: "first", due_at: "2099-01-01" },
      { ...base, id: 2, text: "second" },
    ],
  });
  await user.click(screen.getByRole("button", { name: "返回列表" }));
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByRole("button", { name: "second" })).toBeVisible();
  expect(screen.getByText("第 1 / 1 条")).toBeVisible();
});

it("excludes unsaved words from the review deck", async () => {
  useWords.setState({words:[{id:-1,text:"saving",meaning:"",example:"",scenario_id:"",kind:"word",mastered:false,created_at:""}]});
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "学习新收藏 0" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "复习到期表达 0" })).toBeDisabled();
});

it("advances immediately, keeps a failed review visible, and retries the original choice", async () => {
  let reject!: (error:Error)=>void;
  review.mockReturnValueOnce(new Promise<void>((_resolve,r)=>{reject=r;})).mockResolvedValueOnce(undefined);
  useWords.setState({words:[{id:1,text:"hello",meaning:"你好",example:"",scenario_id:"",kind:"word",mastered:false,created_at:"",last_reviewed}]});
  const user=userEvent.setup();render(<MemoryRouter><WordBag /></MemoryRouter>);
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button",{name:"复习到期表达 1"}));
  await user.click(screen.getByRole("button",{name:/记得/}));
  // The card advances before the network write settles.
  expect(screen.getByText("复习完成！")).toBeVisible();
  await act(async()=>{reject(new Error("lost response"));});
  expect(screen.getByRole("alert")).toHaveTextContent("尚未确认保存");
  await user.click(screen.getByRole("button",{name:"重试保存"}));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(rated().slice(-2)).toEqual([[1,true],[1,true]]);
  expect(review.mock.calls[1][2]).toBe(review.mock.calls[0][2]);
});


it("keeps a repetition blocked while the selected rating awaits confirmation", async()=>{
  review.mockRejectedValueOnce(new Error("response lost"))
    .mockRejectedValueOnce(new Error("response lost again")).mockResolvedValue(undefined);
  useWords.setState({words:[{id:1,text:"hello",meaning:"你好",example:"",scenario_id:"",kind:"word",mastered:false,created_at:"",last_reviewed}]});
  const user=userEvent.setup();render(<MemoryRouter><WordBag /></MemoryRouter>);
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button",{name:"复习到期表达 1"}));await user.click(screen.getByRole("button",{name:"遗忘（忘了）"}));
  expect(screen.getByText("遗忘巩固 · 第 2 / 3 遍")).toBeVisible();
  await user.click(screen.getByRole("button",{name:"hello"}));
  expect(screen.getByRole("button",{name:"完成这遍"})).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"重试保存"}));
  expect(rated()).toEqual([[1,false],[1,false]]);
  expect(screen.getByRole("button",{name:"完成这遍"})).toBeDisabled();
  await user.click(screen.getByRole("button",{name:"重试保存"}));
  expect(rated()).toEqual([[1,false],[1,false],[1,false]]);
  await user.click(screen.getByRole("button",{name:"完成这遍"}));
  await user.click(screen.getByRole("button",{name:"hello"}));
  await user.click(screen.getByRole("button",{name:/遗忘/}));
  expect(screen.getByText("复习完成！")).toBeVisible();
  expect(rated()).toEqual([[1,false],[1,false],[1,false],[1,false]]);
  expect(screen.getByText("记得 0 · 待加强 1")).toBeVisible();
});

it("lets the learner select a saved topic, translate its sentence, and save uncertain", async () => {
  review.mockResolvedValue(undefined);
  useWords.setState({ words: [
    { id: 1, text: "I will look into it.", meaning: "我会调查这件事。", example: "", scenario_id: "cafe", topic: "工作沟通", kind: "sentence", mastered: false, created_at: "", last_reviewed },
    { id: 2, text: "Could I have it iced?", meaning: "能做成冰的吗？", example: "", scenario_id: "cafe", kind: "sentence", mastered: false, created_at: "" },
  ] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "收藏句子 2" }));
  await pickTopic(user, "工作沟通");
  expect(screen.queryByText("Could I have it iced?")).not.toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "复习方式" })).getByRole("button", { name: modeLabels.translate })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByText("我会调查这件事。")).toBeVisible();
  expect(screen.queryByText("I will look into it.")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("输入英文"), "I will look into it");
  await user.click(screen.getByRole("button", { name: "检查答案" }));
  expect(screen.getByText("与参考一致")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "模糊" }));
  expect(rated()).toContainEqual([1, "uncertain"]);
});

it("defaults to a usable cloze when no Chinese prompt is available and keeps flip accessible", async () => {
  useWords.setState({ words: [{ id: 1, text: "receipt", meaning: "", example: "Please keep your receipt.", scenario_id: "cafe", kind: "word", mastered: false, created_at: "", last_reviewed }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await openFilters(user);
  expect(within(screen.getByRole("group", { name: "复习方式" })).getByRole("button", { name: modeLabels.cloze })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByText("Please keep your ____." )).toBeVisible();
  await user.click(screen.getByRole("button", { name: "返回列表" }));
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByRole("button", { name: "receipt" })).toBeVisible();
});

it("masks a content word in a collected sentence even if it ends in a pronoun", async () => {
  useWords.setState({ words: [{ id: 1, text: "I will look into it.", meaning: "我会调查这件事。", example: "I will look into it.", scenario_id: "cafe", kind: "sentence", mastered: false, created_at: "", last_reviewed }] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "收藏句子 1" }));
  await pickMode(user, "cloze");
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  expect(screen.getByText("I will ____ into it.")).toBeVisible();
  await user.type(screen.getByLabelText("输入英文"), "look{Enter}");
  expect(screen.getByText("look")).toBeVisible();
});

it("gives a forgotten expression exactly three fresh attempts and shows its final saved review date", async () => {
  const word = { id: 1, text: "I can meet you halfway.", meaning: "各让一步。", example: "I can meet you halfway.", scenario_id: "negotiation", kind: "phrase", mastered: false, created_at: "", last_reviewed };
  review.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
    useWords.setState({ words: [{ ...word, due_at: "2099-12-31T12:00:00Z" }] });
  });
  useWords.setState({ words: [word] });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await user.click(screen.getByRole("button", { name: "复习到期表达 1" }));
  await user.type(screen.getByLabelText("输入英文"), "I can meet you halfway{Enter}");
  await user.click(screen.getByRole("button", { name: /遗忘/ }));
  expect(screen.getByText("遗忘巩固 · 第 2 / 3 遍")).toBeVisible();
  expect(screen.getByLabelText("输入英文")).toHaveValue("");
  expect(screen.queryByRole("button", { name: "完成这遍" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("输入英文"), "i can meet you halfway{Enter}");
  await user.click(screen.getByRole("button", { name: "完成这遍" }));
  expect(rated()).toEqual([[1, false]]);
  expect(screen.getByText("遗忘巩固 · 第 3 / 3 遍")).toBeVisible();
  expect(screen.getByLabelText("输入英文")).toHaveValue("");
  expect(screen.queryByText("与参考一致")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("输入英文"), "I can meet you halfway.{Enter}");
  await user.click(screen.getByRole("button", { name: /熟悉/ }));
  expect(screen.getByText("复习完成！")).toBeVisible();
  expect(await screen.findByText(/下次复习.*2099/)).toBeVisible();
  expect(rated()).toEqual([[1, false], [1, true]]);
});

it("interleaves a mixed group by pass, respects the initial quota even when ratings change, and counts distinct expressions", async () => {
  const base = { meaning: "释义", example: "", scenario_id: "", kind: "phrase", mastered: false, created_at: "", last_reviewed };
  review.mockResolvedValue(undefined);
  useWords.setState({ words: ["first", "second", "third"].map((text, i) => ({ ...base, id: i + 1, text })) });
  const user = userEvent.setup();
  render(<MemoryRouter><WordBag /></MemoryRouter>);
  await pickMode(user, "flip");
  await user.click(screen.getByRole("button", { name: "复习到期表达 3" }));
  for (const [word, rating] of [["first", /遗忘/], ["second", /^模糊$/], ["third", /熟悉/]] as const) {
    expect(screen.getByRole("button", { name: word })).toBeVisible();
    await user.click(screen.getByRole("button", { name: rating }));
  }
  expect(screen.getByText("遗忘巩固 · 第 2 / 3 遍")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "first" }));
  await user.click(screen.getByRole("button", { name: "完成这遍" }));
  expect(screen.getByText("模糊巩固 · 第 2 / 2 遍")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "second" }));
  await user.click(screen.getByRole("button", { name: /遗忘/ }));
  expect(screen.getByText("遗忘巩固 · 第 3 / 3 遍")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "first" }));
  await user.click(screen.getByRole("button", { name: "模糊" }));
  expect(screen.getByText("熟悉 1 · 模糊 1 · 遗忘 1")).toBeVisible();
  expect(rated()).toEqual([[1, false], [2, "uncertain"], [3, true], [2, false], [1, "uncertain"]]);
});
