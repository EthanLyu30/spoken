import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PracticePrep from "./PracticePrep";
import { getCoaching, getSession, postTurnCorrection, request } from "../lib/api";
import SessionView from "./SessionView";
import { useCustomScene } from "../store/custom";
import { speakText } from "../lib/speech";
import { beginSpeechPlayback } from "../store/speechPlayback";

vi.mock("../components/dictionary/InteractiveEnglishText", () => ({ InteractiveEnglishText: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock("../lib/api", () => ({ getCoaching: vi.fn(), getSession: vi.fn(), postTurnCorrection: vi.fn(), request: vi.fn() }));
beforeEach(() => vi.mocked(request).mockResolvedValue({revision: 0, cues: null}));
vi.mock("../lib/speech", async (original) => ({ ...await original<typeof import("../lib/speech")>(), speakText: vi.fn() }));
beforeEach(() => vi.mocked(getCoaching).mockResolvedValue({ revision: "empty", examples: [], patterns: [] }));
afterEach(() => useCustomScene.getState().clear());

function PracticeDestination() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}

function renderCafe() {
  return render(<MemoryRouter initialEntries={["/prepare/cafe?focus=articles"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
    <Route path="/practice/:scenarioId" element={<PracticeDestination />} />
  </Routes></MemoryRouter>);
}

it("lets a learner replace a café phrase and remove it from the interactive menu", async () => {
  const user = userEvent.setup();
  type Cue = {id: string; keyword: string; meaning: string; sentence: string; kind: string};
  let list: Cue[] | null = null;
  let revision = 0;
  vi.mocked(request).mockImplementation(async (_url, init) => {
    if (init?.method === "PATCH") {
      const change = JSON.parse(String(init.body));
      const current: Cue[] = list ?? change.defaults;
      list = change.action === "remove" ? current.filter(row => row.id !== change.id)
        : current.map(row => row.id === change.cue.id ? change.cue : row);
      revision++;
    }
    return {revision, cues: list};
  });
  renderCafe();
  const menu = within(screen.getByRole("region", {name: "预习菜单"}));
  await user.click(menu.getByRole("button", {name: "编辑预习"}));
  await user.selectOptions(menu.getByRole("combobox", {name: "选择预习内容"}), "default-2");
  const sentence = menu.getByRole("textbox", {name: "例句"});
  await user.clear(sentence);
  await user.type(sentence, "Could you use oat milk instead?");
  await user.click(menu.getByRole("button", {name: "保存修改"}));
  expect(await menu.findByText("Could you use oat milk instead?")).toBeVisible();
  await user.click(menu.getByRole("button", {name: "编辑预习"}));
  await user.selectOptions(menu.getByRole("combobox", {name: "选择预习内容"}), "default-2");
  await user.click(menu.getByRole("button", {name: "移除这条"}));
  expect(menu.queryByText("Could you use oat milk instead?")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", {name: "听燕麦奶的例句"})).not.toBeInTheDocument();
});

it("connects countertop objects and menu buttons to the same cancellable scene playback", async () => {
  const user = userEvent.setup();
  const stops: ReturnType<typeof vi.fn>[] = [];
  vi.mocked(speakText).mockImplementation(() => {
    const clip = beginSpeechPlayback("browser");
    clip.update({ phase: "speaking" });
    const stop = vi.fn(() => { clip.update({ phase: "cancelled" }); });
    stops.push(stop);
    return { status: clip.status, stop, done: Promise.resolve() };
  });
  renderCafe();
  const header = within(screen.getByRole("banner"));
  expect(header.getByRole("link", { name: "场景练习" })).toHaveAttribute("href", "/scenes");
  expect(header.getByRole("link", { name: "Spoken 首页" })).toHaveAttribute("href", "/");
  await user.click(header.getByRole("button", { name: "暂停动效" }));
  expect(header.getByRole("button", { name: "开启动效" })).toBeVisible();
  const menu = within(screen.getByRole("region", { name: "预习菜单" }));
  expect(menu.getByText("I'd like a latte, please.")).toBeVisible();
  expect(menu.getByText("Can I get it with oat milk?")).toBeVisible();
  expect(menu.getByText("Can I pay by card?")).toBeVisible();
  expect(screen.queryByText("上次标记")).toBeNull();
  const milk = screen.getByRole("button", { name: "听燕麦奶的例句" });
  milk.focus();
  await user.keyboard("{Enter}");
  expect(milk).toHaveAttribute("aria-pressed", "true");
  expect(speakText).toHaveBeenLastCalledWith("Can I get it with oat milk?", "cafe");
  expect(menu.getByRole("button", { name: "停止朗读 oat milk" })).toBeVisible();
  await user.click(menu.getByRole("button", { name: "朗读 pay by card" }));
  expect(stops[0]).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "听刷卡的例句" })).toHaveAttribute("aria-pressed", "true");
  expect(speakText).toHaveBeenLastCalledWith("Can I pay by card?", "cafe");
  await user.click(screen.getByRole("link", { name: "开始对话" }));
  expect(screen.getByText("/practice/cafe?focus=articles")).toBeVisible();
  expect(stops[1]).toHaveBeenCalledOnce();
});

it("places a learner's marked latte correction beside that cue and keeps unrelated history accessible", async () => {
  const user = userEvent.setup();
  const example = { session_id: 47, turn_index: 3, scenario_id: "cafe", original: "One large latte please.",
    previous_partner_message: "What would you like?", corrections: [{ original: "latte please", suggestion: "latte, please", note: "停顿", marked: true }] };
  const other = { ...example, turn_index: 5, original: "A platter, thanks.", corrections: [{ original: "platter", suggestion: "plate", note: "用词" }] };
  vi.mocked(getCoaching).mockResolvedValue({ revision: "history", patterns: [], examples: [other, example] });
  renderCafe();
  const menu = within(screen.getByRole("region", { name: "预习菜单" }));
  expect(await menu.findByText(example.original)).toBeVisible();
  await user.click(menu.getByText("看参考说法"));
  expect(menu.getByText("One large latte, please.")).toBeVisible();
  expect(menu.getByText("停顿")).toBeVisible();
  expect(menu.getByRole("link", { name: "重练原句" })).toHaveAttribute("href", "/prepare/cafe?review=47:3");
  const personal = within(screen.getByRole("complementary", { name: "你的易错表达" }));
  expect(personal.getByRole("link", { name: "重练" })).toHaveAttribute("href", "/prepare/cafe?review=47:5");
});

it("lets a learner review fixed airport phrases and bring the article focus into the conversation", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/prepare/airport?focus=articles"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
    <Route path="/practice/:scenarioId" element={<PracticeDestination />} />
  </Routes></MemoryRouter>);
  const focus = screen.getByRole("region", { name: "专项复练 · 冠词" });
  expect(within(focus).getByText(/check ___ bag/)).toBeVisible();
  expect(screen.getByRole("region", { name: "关键词与句型" })).toHaveTextContent("check a bag");
  await user.click(within(focus).getByText("查看参考说法"));
  expect(within(focus).getByText("I need to check a bag.")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "开始场景练习" }));
  expect(screen.getByText("/practice/airport?focus=articles")).toBeVisible();
});

it("uses the learner's own airport sentence and correction for a personal warm-up", async () => {
  const user = userEvent.setup();
  const corrections = [{ original: "boarding pass", suggestion: "a boarding pass", note: "补冠词", category: "articles" as const, turn_index: 1 }];
  vi.mocked(getCoaching).mockResolvedValue({ revision: "airport", patterns: [], examples: [{ session_id: 19, turn_index: 1, scenario_id: "airport",
    original: "I need boarding pass.", previous_partner_message: "How can I help?", corrections }] });
  vi.mocked(getSession).mockResolvedValue({ id: 19, scenario_id: "airport", overall: 75, created_at: "2026-11-17T15:00:00Z",
    summary: "", tip: "", scores: [], corrections,
    messages: [{ role: "assistant", content: "How can I help?" }, { role: "user", content: "I need boarding pass." }] });
  render(<MemoryRouter initialEntries={["/prepare/airport"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
  </Routes></MemoryRouter>);
  const personal = await screen.findByRole("complementary", { name: "你的易错表达" });
  expect(personal).toHaveTextContent("I need a boarding pass.");
  await user.click(within(personal).getByRole("link", { name: "重练" }));
  const replay = await screen.findByRole("region", { name: "重练原句" });
  expect(await within(replay).findByText("I need boarding pass.")).toBeVisible();
  expect(within(replay).getByText("How can I help?")).toBeVisible();
  expect(getSession).toHaveBeenCalledWith(19, expect.any(AbortSignal));
});

it.each(["snapshot", "legacy"])("checks a custom-scene replay using its saved context (%s)", async (kind) => {
  const user = userEvent.setup();
  const repair = { title: "Bike repair", title_zh: "修自行车", partner_role: "Mechanic", goal: "Ask the repair price",
    persona: "Works at the shop", opening_line: "What's broken?" };
  const custom = kind === "snapshot" ? repair : null;
  useCustomScene.getState().setScene({ ...repair, title: "Museum tickets", title_zh: "买门票" });
  const corrections = [{ original: "repair", suggestion: "a repair", note: "补冠词", category: "articles" as const, turn_index: 1 }];
  vi.mocked(getCoaching).mockResolvedValue({ revision: "custom", patterns: [], examples: [{ session_id: 20, turn_index: 1, scenario_id: "custom",
    original: "I need repair.", previous_partner_message: "What's broken?", corrections }] });
  vi.mocked(getSession).mockResolvedValue({ id: 20, scenario_id: "custom", overall: 75, created_at: "2026-11-17T15:00:00Z",
    summary: "", tip: "", scores: [], corrections, custom,
    messages: [{ role: "assistant", content: "What's broken?" }, { role: "user", content: "I need repair." }] });
  vi.mocked(postTurnCorrection).mockResolvedValue({ original: "I need a repair.", natural: true,
    suggestion: "I need a repair.", issues: [], explanation: "原意保留" });
  render(<MemoryRouter initialEntries={["/prepare/airport"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
  </Routes></MemoryRouter>);
  const personal = await screen.findByRole("complementary", { name: "你的易错表达" });
  const link = within(personal).getByRole("link", { name: "重练" });
  expect(link).toHaveAttribute("href", "/prepare/custom?review=20:1");
  if (kind === "legacy") useCustomScene.getState().clear();
  await user.click(link);
  const replay = await screen.findByRole("region", { name: "重练原句" });
  await user.type(await within(replay).findByRole("textbox", { name: "这次的说法" }), "I need a repair.");
  await user.click(within(replay).getByRole("button", { name: "检查这次说法" }));
  expect(await within(replay).findByText("原意保留")).toBeVisible();
  expect(postTurnCorrection).toHaveBeenLastCalledWith(expect.objectContaining({
    scenario_id: "custom", custom: custom ?? undefined, previous_partner_message: "What's broken?",
  }), expect.any(AbortSignal));
  useCustomScene.getState().clear();
});

it("reopens saved coaching exercises from history without a local scene", async () => {
  useCustomScene.getState().clear();
  const exercise = { partner_line: "Would you like to borrow anything?", task: "借一支手电筒。",
    hint: "Could I borrow ___?", example: "Could I borrow a flashlight?" };
  vi.mocked(getSession).mockResolvedValue({ id: 41, scenario_id: "custom", overall: 80,
    created_at: "2026-11-17T15:00:00Z", scores: [], summary: "", tip: "", messages: [],
    custom: {title: "Gear rental", title_zh: "租装备", partner_role: "Clerk", goal: "借装备。",
      persona: "You work at the gear desk.", opening_line: "What do you need?",
      practice_exercises: [exercise, {...exercise, partner_line: "Anything else?"}]},
  });
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/session/41"]}><Routes>
    <Route path="/session/:id" element={<SessionView />} />
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
  </Routes></MemoryRouter>);
  await user.click(await screen.findByRole("link", {name: "再做这次的专项练习"}));
  expect(await screen.findByText(exercise.partner_line)).toBeVisible();
  await user.click(screen.getByRole("button", {name: "下一句"}));
  expect(screen.getByText("Anything else?")).toBeVisible();
});

it("lets the learner try a new situation before showing the answer and checks the target skill", async () => {
  const user = userEvent.setup();
  const exercise = { partner_line: "How can I help you?", task: "用礼貌问句询问行李寄存柜在哪里。",
    hint: "Could you tell me where ___?", example: "Could you tell me where the lockers are?" };
  useCustomScene.getState().setScene({ title: "At the ferry terminal", title_zh: "渡轮码头", partner_role: "Attendant",
    goal: "向工作人员打听寄存柜和登船信息。", persona: "You work at the ferry terminal.", opening_line: "Where are you headed?",
    practice_exercises: [exercise, { ...exercise, partner_line: "What else would you like to know?",
      task: "用间接问句询问渡轮几点出发。", example: "Do you know when the ferry leaves?" }],
    practice_cues: [{ keyword: "Could you tell me…?", meaning: "礼貌地问工作人员", sentence: "Could you tell me where the toilets are?" }],
  });
  const correct = { original: exercise.example, natural: true, suggestion: exercise.example, issues: [] };
  vi.mocked(postTurnCorrection).mockResolvedValueOnce({ ...correct, original: "Where are the lockers?", task_met: false,
    explanation: "直接问句很自然。试着在前面加礼貌的引导语。" })
    .mockResolvedValueOnce({ ...correct, task_met: true, explanation: "你用了礼貌的问法，后面是陈述语序。" });
  render(<MemoryRouter initialEntries={["/prepare/custom"]}><Routes>
    <Route path="/prepare/:scenarioId" element={<PracticePrep />} />
  </Routes></MemoryRouter>);
  expect(screen.getByRole("main")).toHaveFocus();
  expect(screen.queryByRole("region", { name: "接着再说一句" })).not.toBeInTheDocument();
  const first = within(screen.getByRole("region", { name: "先试一句" }));
  expect(first.getByText(exercise.task)).toBeVisible();
  expect(first.getByText(exercise.partner_line)).toBeVisible();
  expect(first.getByText(exercise.example)).not.toBeVisible();
  const input = first.getByRole("textbox", { name: "用英语回答" });
  await user.click(input);
  await user.paste("Where are the lockers?");
  await user.click(first.getByRole("button", { name: "检查这次说法" }));
  expect(await first.findByText(/直接问句很自然/)).toBeVisible();
  expect(first.queryByText("练到这一点了")).not.toBeInTheDocument();
  await user.clear(input);
  await user.paste(exercise.example);
  await user.click(first.getByRole("button", { name: "检查这次说法" }));
  expect(await first.findByText("练到这一点了")).toBeVisible();
  expect(screen.getByText("1 / 2")).toBeVisible();
  expect(postTurnCorrection).toHaveBeenLastCalledWith(expect.objectContaining({ text: exercise.example,
    scenario_id: "custom", practice_exercise: exercise }), expect.any(AbortSignal));
  await user.click(screen.getByRole("button", { name: "下一句" }));
  const second = within(screen.getByRole("region", { name: "接着再说一句" }));
  expect(second.getByRole("heading")).toHaveFocus();
  expect(second.getByText("用间接问句询问渡轮几点出发。")).toBeVisible();
  await user.click(second.getByRole("textbox", { name: "用英语回答" }));
  await user.paste("When does it leave?");
  await user.click(screen.getByRole("button", { name: "上一句" }));
  expect(first.getByRole("textbox", { name: "用英语回答" })).toHaveValue(exercise.example);
  expect(first.getByText("练到这一点了")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "下一句" }));
  expect(second.getByRole("textbox", { name: "用英语回答" })).toHaveValue("When does it leave?");
});
