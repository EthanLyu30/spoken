import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PracticeRecord, ProgressSessions, SessionSummary } from "../lib/api";

const mock = vi.hoisted(() => ({
  records: [] as PracticeRecord[], sessions: [] as SessionSummary[],
  latest: null as ProgressSessions["latest"], errors: [] as string[], reload: vi.fn(),
  correctionFocus: [] as NonNullable<ProgressSessions["correction_focus"]>,
}));
vi.mock("../hooks/useProgressData", () => ({ useProgressData: () => ({
  sessions: mock.sessions, practice: mock.records, stats: null, insights: null, latest: mock.latest, correctionFocus: mock.correctionFocus,
  status: mock.errors.includes("sessions") ? "error" : "ready", errors: mock.errors,
  sessionsPending: false, practicePending: false, statsPending: false, reload: mock.reload,
}) }));
vi.mock("../components/EChart", () => ({ EChart: () => null }));
import Progress from "./Progress";
import * as api from "../lib/api";
import { useAuth } from "../store/auth";
import { useCustomScene } from "../store/custom";
import { invalidateProgress } from "../lib/progressCache";
vi.mock("../components/InterviewResults", () => ({InterviewResults: ({result}: {result:api.InterviewScore}) => <p>{result.results[0].question}</p>}));
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});});
afterEach(()=>vi.restoreAllMocks());

const record = (id: number, score: number, score_max?: number): PracticeRecord => ({
  id, kind: "interview", score, score_max, title: `访谈记录${id}`, created_at: "2026-10-30T02:00:00Z",
});
function show() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Progress /></MemoryRouter>);
}
beforeEach(() => {
  mock.records = [];
  mock.sessions = [];
  mock.latest = null;
  mock.correctionFocus = [];
  mock.errors = [];
  mock.reload.mockClear();
  useAuth.setState({ user: null });
  vi.spyOn(api, "getCoaching").mockResolvedValue({ revision: "empty", examples: [], patterns: [] });
});

it("links a recurring article problem to the airport practice that uses it", () => {
  mock.correctionFocus = [{ category: "articles", sessions: 3, turns: 5, scenario_id: "airport" }];
  show();
  const focus = screen.getByRole("region", { name: "优先复练" });
  expect(focus).toHaveTextContent("3 次练习、5 句话");
  expect(within(focus).getByRole("link", { name: /练冠词/ })).toHaveAttribute("href", "/prepare/airport?focus=articles");
});

it("opens the complete grammar ranking on demand and practises a selected type using saved sentences", async () => {
  const example = (session: number, line: string, before: string, after: string) => ({
    session_id: session, turn_index: 1, scenario_id: "airport", original: line, previous_partner_message: "",
    corrections: [{ original: before, suggestion: after, note: "注意动词和宾语的搭配。", category: "word_choice", turn_index: 1 }],
  });
  const groups = [
    ["article_missing", 9], ["present_perfect", 7], ["past_simple", 5], ["article_choice", 5],
    ["article_extra", 4], ["agreement", 3], ["verb_object_collocation", 2],
  ].map(([kind, occurrences]) => ({ kind, occurrences, sentences: 2, examples: [
    example(19, "Could I do a reservation?", "do a reservation", "make a reservation"),
    example(10, "I need to do a decision.", "do a decision", "make a decision"),
  ] }));
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ sessions_analyzed: 12, session_limit: 50, example_limit: 5, groups }),
    { headers: { "Content-Type": "application/json" } },
  ));
  show();
  const entry = screen.getByRole("button", { name: /语法错误统计/ });
  expect(entry).toHaveAttribute("aria-expanded", "false");
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(entry);
  const ranking = await screen.findByRole("list", { name: "按出现次数排列的错误类型" });
  expect(screen.getByText(/最近 12 次.*最多 50 次/)).toBeVisible();
  const rows = within(ranking).getAllByRole("listitem");
  expect(rows).toHaveLength(7);
  expect(rows[0]).toHaveTextContent("漏掉冠词");
  expect(rows[0]).toHaveTextContent("9 处");
  expect(rows[6]).toHaveTextContent("动宾搭配");
  expect(rows[6]).toHaveTextContent("2 处");
  fireEvent.click(within(rows[6]).getByRole("button", { name: /动宾搭配/ }));
  expect(within(rows[6]).getByText("Could I do a reservation?")).toBeVisible();
  expect(within(rows[6]).getByText("make a reservation")).toBeVisible();
  fireEvent.click(within(rows[6]).getByRole("button", { name: "下一句" }));
  expect(within(rows[6]).getByText("I need to do a decision.")).toBeVisible();
  const reference = within(rows[6]).getByText("make a decision");
  fireEvent.click(within(rows[6]).getByRole("button", { name: "填空" }));
  expect(within(rows[6]).getByRole("textbox", { name: "填入英文" })).toBeVisible();
  expect(reference).not.toBeVisible();
});

it("provides a retry for unavailable grammar statistics and an empty state for a report without errors", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline")).mockResolvedValue(new Response(
    JSON.stringify({ sessions_analyzed: 4, session_limit: 50, example_limit: 5, groups: [] }),
    { headers: { "Content-Type": "application/json" } },
  ));
  show();
  fireEvent.click(screen.getByRole("button", { name: /语法错误统计/ }));
  fireEvent.click(await screen.findByRole("button", { name: "重新加载统计" }));
  expect(await screen.findByText(/还没有可统计的语法纠错/)).toBeVisible();
  expect(screen.getByText(/最近 4 次.*最多 50 次/)).toBeVisible();
  expect(screen.queryByRole("list", { name: "按出现次数排列的错误类型" })).not.toBeInTheDocument();
});

it("blanks the selected article subtype when the recorded sentence has multiple article edits", async () => {
  const line = "I like the cats and I need a umbrella.";
  const full = { original: line, suggestion: "I like cats and I need an umbrella.", note: "", category: "articles" };
  const group = (kind: string, before: string, after: string) => ({
    kind, occurrences: 1, sentences: 1, examples: [{ session_id: 8, turn_index: 0, scenario_id: "friend",
      original: line, previous_partner_message: "", corrections: [{ ...full, original: before, suggestion: after }, full] }],
  });
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    sessions_analyzed: 1, session_limit: 50, example_limit: 5,
    groups: [group("article_extra", "the cats", "cats"), group("article_choice", "a umbrella", "an umbrella")],
  }), { headers: { "Content-Type": "application/json" } }));
  show();
  fireEvent.click(screen.getByRole("button", { name: /语法错误统计/ }));
  fireEvent.click(await screen.findByRole("button", { name: /冠词选错/ }));
  fireEvent.click(screen.getByRole("button", { name: "填空" }));
  const drill = screen.getByRole("region", { name: "填空练习" });
  expect(drill).toHaveTextContent("I like cats and I need ____ umbrella.");
  fireEvent.change(within(drill).getByRole("textbox"), { target: { value: "an" } });
  fireEvent.click(within(drill).getByRole("button", { name: "检查答案" }));
  expect(within(drill).getByRole("status")).toHaveTextContent("答对了");
});

it("starts a fresh drill when moving between grammar examples with the same saved turn and wording", async () => {
  const example = {
    session_id: 8, turn_index: 0, scenario_id: "friend", original: "I need map. I need map.", previous_partner_message: "",
    corrections: [{ original: "need map", suggestion: "need a map", note: "", category: "articles" as const }],
  };
  vi.spyOn(api, "getGrammarStatistics").mockResolvedValue({
    sessions_analyzed: 1, session_limit: 50, example_limit: 5,
    groups: [{ kind: "article_missing", occurrences: 2, sentences: 2, examples: [example, example] }],
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: /语法错误统计/ }));
  fireEvent.click(await screen.findByRole("button", { name: /漏掉冠词/ }));
  fireEvent.click(screen.getByRole("button", { name: "填空" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: "下一句" }));
  expect(screen.queryByRole("region", { name: "填空练习" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "填空" }));
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("cannot show a previous learner's pending grammar report after switching accounts", async () => {
  const old = deferred<api.GrammarStatistics>();
  const getStats = vi.spyOn(api, "getGrammarStatistics").mockReturnValueOnce(old.promise).mockResolvedValue({
    sessions_analyzed: 3, session_limit: 50, example_limit: 5, groups: [],
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: /语法错误统计/ }));
  act(() => useAuth.setState({ user: { id: 906, email: "new@example.test", display_name: "", avatar_url: "", created_at: "" } }));
  expect(getStats.mock.calls[0][0]?.aborted).toBe(true);
  const entry = screen.getByRole("button", { name: /语法错误统计/ });
  expect(entry).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(entry);
  expect(await screen.findByText(/最近 3 次.*最多 50 次/)).toBeVisible();
  await act(async () => old.resolve({ sessions_analyzed: 13, session_limit: 50, example_limit: 5, groups: [] }));
  expect(screen.queryByText(/最近 13 次/)).not.toBeInTheDocument();
});

it("opens an AI coaching scene based on the learner's evidence", async () => {
  mock.sessions = [{ id: 9, scenario_id: "airport", overall: 75, created_at: "2026-11-17T16:00:00Z" }];
  const example = { session_id: 9, turn_index: 1, scenario_id: "airport", original: "I need boarding pass.",
    previous_partner_message: "How can I help?", corrections: [{ original: "boarding pass", suggestion: "a boarding pass", note: "加冠词" }] };
  const focus = { kind: "article_missing", category: "articles", sessions: 1, sentences: 1, occurrences: 2 } as const;
  const practice_exercises = [{ partner_line: "What will you need?", task: "用 a/an 说你需要一张日票。",
    hint: "I'd like ___, please.", example: "I'd like a day ticket, please." }];
  vi.mocked(api.getCoaching).mockResolvedValue({ revision: "rail-pass", examples: [example], patterns: [focus] });
  vi.spyOn(api, "postCoachingPlan").mockResolvedValue({ revision: "rail-pass", focus, summary: "你在 boarding pass 前漏了 a。",
    evidence: [example], scene: { title: "Rail pass", title_zh: "车站买票", goal: "Buy a pass", persona: "Work at the ticket counter",
      opening_line: "How can I help?", partner_role: "Clerk", practice_exercises },
  });
  show();
  const panel = await screen.findByRole("region", { name: "个人复练" });
  expect(panel).toHaveTextContent("漏掉冠词");
  expect(panel).toHaveTextContent("单次练习发现 · 1 次练习 · 2 处");
  fireEvent.click(within(panel).getByRole("button", { name: "让 Pip 排训练计划" }));
  const plan = await within(panel).findByRole("region", { name: "Pip 的训练计划" });
  expect(plan).toHaveTextContent("你在 boarding pass 前漏了 a。");
  expect(plan).toHaveTextContent("来自 1 次练习");
  expect(within(plan).getByRole("link", { name: "重说这句" })).toHaveAttribute("href", "/prepare/airport?review=9:1");
  expect(plan).toHaveTextContent(practice_exercises[0].task);
  const practice = within(plan).getByRole("link", { name: "开始专项练习" });
  expect(practice).toHaveAttribute("href", "/prepare/custom");
  fireEvent.click(practice);
  expect(useCustomScene.getState().scene?.practice_exercises).toEqual(practice_exercises);
  useCustomScene.getState().clear();
});

it("cancels a coaching plan when progress changes and ignores a late response", async () => {
  mock.sessions = [{ id: 12, scenario_id: "airport", overall: 71, created_at: "2026-11-18T03:00:00Z" }];
  const example = { session_id: 12, turn_index: 1, scenario_id: "airport", original: "I need boarding pass.",
    previous_partner_message: "How can I help?", corrections: [] };
  const focus = { kind: "article_missing", category: "articles", sessions: 1, sentences: 1, occurrences: 1 } as const;
  vi.mocked(api.getCoaching).mockResolvedValueOnce({ revision: "first", examples: [example], patterns: [focus] })
    .mockResolvedValue({ revision: "second", examples: [example], patterns: [{ ...focus, sessions: 2, sentences: 2, occurrences: 2 }] });
  let resolve!: (plan: api.CoachingPlan) => void;
  const generate = vi.spyOn(api, "postCoachingPlan").mockImplementation(() => new Promise((done) => { resolve = done; }));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "让 Pip 排训练计划" }));
  const signal = generate.mock.calls[0][1];
  act(() => invalidateProgress());
  expect(await screen.findByText(/反复出现 · 2 次练习/)).toBeVisible();
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve({ revision: "first", focus, summary: "旧计划", evidence: [],
    scene: { title: "Old", title_zh: "旧", goal: "", persona: "", opening_line: "", partner_role: "", practice_exercises: [] } }); });
  expect(screen.queryByText("旧计划")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "让 Pip 排训练计划" })).toBeEnabled();
});

it("provides the plotted conversations and latest ability scores as named tables", async () => {
  mock.sessions = [
    { id: 3, scenario_id: "airport", overall: null, created_at: "2026-11-13T08:00:00Z" },
    { id: 2, scenario_id: "hotel", overall: 83, created_at: "2026-11-12T08:00:00Z" },
    { id: 1, scenario_id: "cafe", overall: 70, created_at: "2026-11-11T08:00:00Z" },
  ];
  mock.latest = {
    id: 2,
    scores: [
      { key: "fluency", label_en: "Fluency", label_zh: "流利度", score: 85 },
      { key: "grammar", label_en: "Grammar", label_zh: "语法", score: 0 },
    ],
  };
  show();

  fireEvent.click(screen.getByText("查看场景对话趋势数据", { selector: "summary" }));
  const trend = await screen.findByRole("table", { name: "场景对话趋势" });
  const [, earlier, later] = within(trend).getAllByRole("row");
  expect(within(trend).getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText("未评分")).toBeVisible();
  expect(screen.getByText("76.5")).toBeVisible();
  expect(within(earlier).getByRole("cell", { name: "咖啡馆点单" })).toBeVisible();
  expect(within(earlier).getByRole("cell", { name: "70" })).toBeVisible();
  expect(within(later).getByRole("cell", { name: "酒店入住" })).toBeVisible();
  expect(within(later).getByRole("cell", { name: "83" })).toBeVisible();

  fireEvent.click(screen.getByText("查看最近一次能力雷达", { selector: "summary" }));
  const scores = await screen.findByRole("table", { name: "最近一次能力评分" });
  const [, fluency, grammar] = within(scores).getAllByRole("row");
  expect(within(fluency).getByRole("rowheader", { name: "流利度" })).toBeVisible();
  expect(within(fluency).getByRole("cell", { name: "85" })).toBeVisible();
  expect(within(grammar).getByRole("rowheader", { name: "语法" })).toBeVisible();
  expect(within(grammar).getByRole("cell", { name: "0" })).toBeVisible();
});

it.each(["sessions", "practice"])("offers a retry when %s fail instead of inviting a first practice", (source) => {
  mock.errors = [source];
  show();

  expect(screen.getByRole("heading", { name: "学习记录加载失败" })).toBeVisible();
  expect(screen.queryByText("这里，等你的第一次开口。")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "试试一组主题访谈" })).not.toBeInTheDocument();
  if (source === "sessions") {
    expect(screen.queryByText("第一条曲线，从第一次开口开始。")).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole("button", { name: "重试加载记录" }));
  expect(mock.reload).toHaveBeenCalledOnce();
});

it("keeps available records and uses an empty state only for a filter whose source loaded", () => {
  mock.errors = ["sessions"];
  mock.records = [record(1, 4, 5)];
  show();
  expect(screen.getByRole("button", { name: /访谈记录1/ })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "场景对话" }));
  expect(screen.getByRole("button", { name: "重试加载记录" })).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "跟读" }));
  expect(screen.getByText("这里，等你的第一次开口。")).toBeVisible();
  expect(screen.queryByRole("button", { name: "重试加载记录" })).not.toBeInTheDocument();
});

it("shows mixed history in native scales while averaging only the new rubric", () => {
  mock.records = [record(1, 6), record(2, 3, 5), record(3, 5, 5)];
  show();
  const metric = screen.getByText("近期访谈内容均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4")).toBeVisible();
  expect(within(metric).getByText("/ 5")).toBeVisible();
  expect(within(metric).getByText(/旧版 1 次未混入/)).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录1/ })).getByText("/ 6")).toBeVisible();
  expect(within(screen.getByRole("button", { name: /访谈记录2/ })).getByText("/ 5")).toBeVisible();
});

it("keeps an all-legacy average explicitly labelled six-point", () => {
  mock.records = [record(1, 6), record(2, 3)];
  show();
  const metric = screen.getByText("旧版访谈均分").closest(".learning-metric") as HTMLElement;
  expect(within(metric).getByText("4.5")).toBeVisible();
  expect(within(metric).getByText("/ 6")).toBeVisible();
});

const detail = (id:number) => ({...record(id,4,5),detail:JSON.stringify({overall:4,results:[{question:`detail-${id}`,answer:"answer",score:4,feedback:"feedback",sample_answer:"sample"}]})});
function deferred<T>() {
  let resolve!:(value:T)=>void, reject!:(error:Error)=>void;
  const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};
}
it("keeps the most recently selected history when requests complete in reverse order",async()=>{
  mock.records=[record(1,4,5),record(2,4,5)];
  const first=deferred<api.PracticeDetail>();
  vi.spyOn(api,"getPracticeDetail").mockReturnValueOnce(first.promise).mockResolvedValueOnce(detail(2));
  show();fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));fireEvent.click(screen.getByRole("button",{name:/访谈记录2/}));
  await screen.findByText("detail-2");await act(async()=>{first.resolve(detail(1));});
  expect(screen.getByText("detail-2")).toBeVisible();expect(screen.queryByText("detail-1")).not.toBeInTheDocument();
});
it("does not let an older failure clear the active history loading or show an error",async()=>{
  mock.records=[record(1,4,5),record(2,4,5)];
  const first=deferred<api.PracticeDetail>(),second=deferred<api.PracticeDetail>();
  vi.spyOn(api,"getPracticeDetail").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  show();fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));fireEvent.click(screen.getByRole("button",{name:/访谈记录2/}));
  await act(async()=>{first.reject(new Error("offline"));});
  expect(screen.getByRole("button",{name:/访谈记录2/})).toBeDisabled();
  expect(screen.queryByText(/这条旧记录/)).not.toBeInTheDocument();
  await act(async()=>{second.resolve(detail(2));});expect(screen.getByText("detail-2")).toBeVisible();
});
it("cancels history work on owner change even when transport ignores cancellation",async()=>{
  mock.records=[record(1,4,5)];const first=deferred<api.PracticeDetail>();
  const request=vi.spyOn(api,"getPracticeDetail").mockReturnValue(first.promise);
  const view=render(<MemoryRouter><Progress /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button",{name:/访谈记录1/}));
  act(()=>useAuth.setState({user:{id:927,email:"changed@example.test",display_name:"",avatar_url:"",created_at:""}}));
  expect(request.mock.calls[0][1]?.aborted).toBe(true);
  await act(async()=>{first.reject(new Error("offline"));});
  expect(screen.queryByText(/这条旧记录/)).not.toBeInTheDocument();
  view.unmount();
});
