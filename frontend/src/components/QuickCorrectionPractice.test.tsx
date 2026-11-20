import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage, Correction } from "../lib/api";
import { setToken } from "../lib/authToken";
import { CorrectionReview } from "./CorrectionReview";
import { DictionaryContext } from "./dictionary/DictionaryContext";

const tense: Correction = { original: "go", suggestion: "went", note: "昨天的动作要用过去式。", category: "tense", turn_index: 1 };
const article: Correction = { original: "umbrella", suggestion: "an umbrella", note: "单数名词需要冠词。", category: "articles", turn_index: 1 };

function review(original: string, corrections: Correction[]) {
  const messages: ChatMessage[] = [{ role: "assistant", content: "What happened yesterday?" }, { role: "user", content: original }];
  return render(<DictionaryContext.Provider value={{ openDictionary: () => {} }}>
    <CorrectionReview messages={messages} corrections={corrections} scenarioId="airport" />
  </DictionaryContext.Provider>);
}

afterEach(() => vi.unstubAllGlobals());

it("blanks the selected edit in the corrected sentence and allows keyboard retry and escape", async () => {
  const user = userEvent.setup();
  review("I go home with umbrella yesterday.", [tense, article]);
  const buttons = screen.getAllByRole("button", { name: "填空" });
  await user.click(buttons[1]);
  const panel = screen.getByRole("region", { name: "填空练习" });
  expect(within(panel).getByText("I went home with ____ umbrella yesterday.")).toBeVisible();
  // Keep the correction available for the report's PDF while the on-screen
  // exercise conceals it.
  expect(screen.getByText(article.note)).not.toBeVisible();
  const field = within(panel).getByRole("textbox", { name: "填入英文" });
  await user.type(field, "a{Enter}");
  expect(within(panel).getByRole("status")).toHaveTextContent("再试一次");
  await user.clear(field);
  await user.type(field, "AN{Enter}");
  expect(within(panel).getByRole("status")).toHaveTextContent("答对了");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("region", { name: "填空练习" })).not.toBeInTheDocument();
  expect(buttons[1]).toHaveFocus();
  expect(screen.getByRole("button", { name: "重练原句" })).toBeVisible();
});

it("uses the saved fragment when its occurrence is ambiguous and supports an intentional empty answer", async () => {
  const user = userEvent.setup();
  const deletion = { ...article, original: "the rice", suggestion: "rice" };
  review("I like the rice, and they sell the rice.", [deletion]);
  expect(screen.queryByRole("button", { name: "中译英" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "填空" }));
  const panel = screen.getByRole("region", { name: "填空练习" });
  expect(within(panel).getByText("____ rice")).toBeVisible();
  const input = within(panel).getByRole("textbox");
  await user.type(input, "the{Enter}");
  expect(within(panel).getByRole("status")).toHaveTextContent("再试一次");
  await user.click(within(panel).getByRole("button", { name: "此处无需填词" }));
  expect(within(panel).getByRole("status")).toHaveTextContent("答对了");
  await user.click(within(panel).getByText("查看参考片段"));
  expect(within(panel).getByText("rice")).toBeVisible();
});

it("uses a whole sentence on both translation requests when the saved quote repeats in equivalent sentences", async () => {
  const user = userEvent.setup();
  const prompt = "我需要一张地图。";
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      original: "I need map.",
      reference: "I need a map.",
      focus: { original: "map", suggestion: "a map", category: "articles" },
    });
    if (path.endsWith("/translation")) return Response.json({ chinese: prompt });
    expect(body.attempt).toBe("I need a map.");
    expect(body.chinese).toBe(prompt);
    return Response.json({ correct: true, feedback: "答对了。" });
  });
  vi.stubGlobal("fetch", fetcher);
  review("I need map. I need map.", [{ ...article, original: "need map", suggestion: "need a map" }]);
  await user.click(screen.getByRole("button", { name: "中译英" }));
  const panel = screen.getByRole("region", { name: "中译英练习" });
  expect(await within(panel).findByText(prompt)).toBeVisible();
  await user.type(within(panel).getByRole("textbox"), "I need a map.{Enter}");
  await user.click(await within(panel).findByText("查看参考答案"));
  expect(within(panel).getByText("I need a map.")).toBeVisible();
});

it("uses the Chinese translation of the corrected line and grades a paraphrase against the selected change", async () => {
  const user = userEvent.setup();
  const prompt = "我昨天带着一把伞回家了。";
  const fetcher = vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    expect(body.reference).toBe("I went home with an umbrella yesterday.");
    expect(body.focus).toEqual({ original: "go", suggestion: "went", category: "tense" });
    if (path.endsWith("/translation")) return Response.json({ chinese: prompt });
    expect(path).toMatch(/correction-practice\/check$/);
    expect(body.chinese).toBe(prompt);
    expect(body.attempt).toBe("Yesterday I returned home with an umbrella.");
    return Response.json({ correct: true, feedback: "原意和过去的时间都说清楚了。" });
  });
  vi.stubGlobal("fetch", fetcher);
  review("I go home with umbrella yesterday.", [tense, article]);
  expect(fetcher).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole("button", { name: "中译英" })[0]);
  const panel = screen.getByRole("region", { name: "中译英练习" });
  expect(await within(panel).findByText(prompt)).toBeVisible();
  expect(within(panel).queryByText(/went/)).not.toBeInTheDocument();
  await user.type(within(panel).getByRole("textbox"), "Yesterday I returned home with an umbrella.{Enter}");
  expect(await within(panel).findByText("原意和过去的时间都说清楚了。")).toBeVisible();
});

it("aborts loading on identity change and discards a late translation", async () => {
  const user = userEvent.setup();
  setToken("quick-first");
  let resolve!: (value: Response) => void;
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>(done => { resolve = done; });
  }));
  review("I go yesterday.", [tense]);
  await user.click(screen.getByRole("button", { name: "中译英" }));
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    setToken("quick-second");
    resolve(Response.json({ chinese: "上一位学习者的译文。" }));
  });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByText("上一位学习者的译文。")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "中译英练习" })).not.toBeInTheDocument();
});

it("offers a labeled cloze on a historical correction with no matching learner turn", async () => {
  const user = userEvent.setup();
  review("Different line.", [{ ...article, turn_index: null }]);
  expect(screen.queryByRole("button", { name: "中译英" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "填空" }));
  expect(screen.getByText("练习保存的纠错片段")).toBeVisible();
  expect(screen.getByText("____ umbrella")).toBeVisible();
});

it("offers translation when an older correction can be attributed to a learner's sentence", () => {
  review("I need umbrella.", [{ ...article, turn_index: null }]);
  expect(screen.getByRole("button", { name: "中译英" })).toBeVisible();
});

it("closes the previous drill when the learner opens another correction or the whole-sentence replay", async () => {
  const user = userEvent.setup();
  review("I go home with umbrella yesterday.", [tense, article]);
  const buttons = screen.getAllByRole("button", { name: "填空" });
  await user.click(buttons[0]);
  await user.click(buttons[1]);
  expect(screen.getAllByRole("region", { name: "填空练习" })).toHaveLength(1);
  expect(screen.getByText("I went home with ____ umbrella yesterday.")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重练原句" }));
  expect(screen.queryByRole("region", { name: "填空练习" })).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "这次的说法" })).toBeVisible();
});

it("keeps the learner's translation after a temporary grading failure", async () => {
  const user = userEvent.setup();
  let checks = 0;
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/translation")) return Response.json({ chinese: "我昨天回家了。" });
    checks++;
    return checks === 1 ? new Response(null, { status: 503 })
      : Response.json({ correct: true, feedback: "动作和时间都说对了。" });
  });
  review("I go home yesterday.", [tense]);
  await user.click(screen.getByRole("button", { name: "中译英" }));
  const input = await screen.findByRole("textbox", { name: "你的英文译文" });
  await user.type(input, "Yesterday, I returned home.{Enter}");
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(input).toHaveValue("Yesterday, I returned home.");
  await user.click(screen.getByRole("button", { name: "检查答案" }));
  expect(await screen.findByText("动作和时间都说对了。")).toBeVisible();
});

it("switches a word-order translation with an ambiguous prompt to whole-phrase practice in one click", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn(async () => Response.json({
    detail: { code: "translation_prompt_ambiguous", message: "这条纠错无法仅凭中文题面区分，请改用填空练习。" },
  }, { status: 422 }));
  vi.stubGlobal("fetch", fetcher);
  review("We can ship it if you shiftly pay it.", [{ original: "if you shiftly pay it", suggestion: "if you pay it sooner",
    note: "把时间副词放在后面", category: "word_order", turn_index: 1 }]);
  await user.click(screen.getByRole("button", { name: "中译英" }));
  const panel = await screen.findByRole("region", { name: "填空练习" });
  expect(panel).toHaveTextContent("We can ship it if you ____.");
  expect(panel).toHaveTextContent("已切换为填空");
  expect(panel).toHaveTextContent("it / sooner / pay");
  expect(screen.queryByRole("button", { name: "中译英" })).not.toBeInTheDocument();
  const answer = within(panel).getByRole("textbox", { name: "填入英文" });
  await user.type(answer, "sooner pay it{Enter}");
  expect(within(panel).getByText("再试一次")).toBeVisible();
  await user.clear(answer);
  await user.type(answer, "pay it sooner{Enter}");
  expect(within(panel).getByText("答对了")).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("opens the article blank directly when translation lacks a referent", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn(async () => Response.json({
    detail: { code: "translation_prompt_ambiguous", message: "这条纠错无法仅凭中文题面区分，请改用填空练习。" },
  }, { status: 422 }));
  vi.stubGlobal("fetch", fetcher);
  review("I saw dog.", [{ ...article, original: "dog", suggestion: "the dog" }]);
  await user.click(screen.getByRole("button", { name: "中译英" }));

  const panel = await screen.findByRole("region", { name: "填空练习" });
  expect(panel).toHaveTextContent("I saw ____ dog.");
  expect(panel).toHaveTextContent("已切换为填空");
  expect(screen.queryByRole("button", { name: "中译英" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "中译英练习" })).not.toBeInTheDocument();
  await user.type(within(panel).getByRole("textbox", { name: "填入英文" }), "the{Enter}");
  expect(within(panel).getByText("答对了")).toBeVisible();
  await user.click(within(panel).getByRole("button", { name: "收起练习" }));
  await user.click(screen.getByRole("button", { name: "填空" }));
  expect(screen.getByRole("region", { name: "填空练习" })).toHaveTextContent("I saw ____ dog.");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("can retry a temporarily unavailable article translation instead of switching to cloze", async () => {
  const user = userEvent.setup();
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ detail: "翻译练习暂时不可用，请重试。" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ chinese: "我看见旅馆门前的那只狗了。" }));
  vi.stubGlobal("fetch", fetcher);
  review("I saw dog in front of the hotel.", [{ ...article, original: "dog", suggestion: "the dog" }]);
  await user.click(screen.getByRole("button", { name: "中译英" }));
  const panel = screen.getByRole("region", { name: "中译英练习" });
  await user.click(await within(panel).findByRole("button", { name: "重新加载题目" }));
  expect(await within(panel).findByText("我看见旅馆门前的那只狗了。")).toBeVisible();
  expect(screen.queryByRole("region", { name: "填空练习" })).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
