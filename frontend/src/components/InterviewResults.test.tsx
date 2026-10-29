import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { InterviewResult } from "../lib/api";
import { InterviewResults } from "./InterviewResults";
vi.mock("../lib/speech", () => ({ speakText: vi.fn(), stopSpeaking: vi.fn() }));
import { speakText, stopSpeaking } from "../lib/speech";

beforeEach(() => vi.clearAllMocks());

const savedAnswer: InterviewResult = {
  question: "What do you do outside?", answer: "I enjoy running.", score: 4,
  level: "Good", feedback: "Give a reason.", sample_answer: "I like walking in the park with my friends.",
};

function showAnswer(answer: InterviewResult) {
  return render(<InterviewResults result={{ overall: 4, results: [answer] }} onRestart={vi.fn()} onExit={vi.fn()} />);
}

it("shows trusted sample length, estimated time and a safe video reference link", () => {
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url: "https://www.youtube.com/watch?v=abcdefghijk&t=30s", sample_word_count: 65, sample_estimated_seconds: 39 });
  expect(screen.getByText("65 词 · 约 39 秒")).toBeVisible();
  expect(screen.getByText(/110 词\/分钟.*4 秒停顿.*估算/)).toBeVisible();
  const source = screen.getByRole("link", { name: "参考视频思路 · DeepSeek 改写" });
  expect(source).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=30s");
  expect(source).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByRole("button", { name: "DeepSeek 升级版" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "视频原版" })).toBeEnabled();
  expect(screen.queryByTitle(/视频原版/)).not.toBeInTheDocument();
});

it.each([
  "javascript:alert(1)", "http://www.youtube.com/watch?v=abcdefghijk",
  "https://www.youtube.com.evil.test/watch?v=abcdefghijk", "https://youtube.com@evil.test/watch?v=abcdefghijk",
  "https://www.youtube.com/playlist?list=abcdefghijk", "https://youtu.be/", "https://www.youtube.com/watch?v=bad",
  "https://user:pass@www.youtube.com/watch?v=abcdefghijk", "https://www.youtube.com:8443/watch?v=abcdefghijk",
  "https://www.youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv",
  "https://www.youtube-nocookie.com/embed/abcdefghijk", "https://www.youtube.com/redirect?v=abcdefghijk",
])("does not label unsafe or non-video source %s as a video reference", (sample_source_url) => {
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url });
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByRole("link", { name: /参考视频/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "视频原版" })).toBeDisabled();
  expect(screen.getByText(/暂无已核对的视频原版/)).toBeVisible();
  expect(screen.queryByTitle(/视频原版/)).not.toBeInTheDocument();
});

it.each(["https://youtu.be/abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk"])("accepts a valid alternate YouTube video URL %s", (sample_source_url) => {
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url });
  expect(screen.getByRole("link", { name: "参考视频思路 · DeepSeek 改写" })).toHaveAttribute("href", sample_source_url);
});

it("keeps AI provenance even when an AI sample includes a video URL", () => {
  showAnswer({ ...savedAnswer, sample_source: "ai_generated", sample_source_url: "https://youtu.be/abcdefghijk" });
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "视频原版" })).toBeDisabled();
});

it("estimates missing metadata for old history and keeps playback and navigation usable", async () => {
  const user = userEvent.setup();
  const exit = vi.fn();
  const restart = vi.fn();
  render(<InterviewResults result={{ overall: 4, results: [savedAnswer] }} onRestart={restart} onExit={exit} exitLabel="回历史记录" />);
  expect(screen.getByText("9 词 · 约 9 秒")).toBeVisible();
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.getByRole("button", { name: "视频原版" })).toBeDisabled();
  expect(screen.getByText(/暂无已核对的视频原版/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "朗读范例" }));
  expect(speakText).toHaveBeenCalledWith(savedAnswer.sample_answer);
  await user.click(screen.getByRole("button", { name: "回历史记录" }));
  await user.click(screen.getByRole("button", { name: "再练一组" }));
  expect(exit).toHaveBeenCalledTimes(1);
  expect(restart).toHaveBeenCalledTimes(1);
});

it("includes numbers and contractions when estimating an old saved sample", () => {
  showAnswer({ ...savedAnswer, sample_answer: "I take a 4-day trip in 2026. It's fun." });
  expect(screen.getByText("10 词 · 约 9 秒")).toBeVisible();
});

it("switches the question together with its actual answer, feedback and sample", async () => {
  const user = userEvent.setup();
  const result = {
    overall: 4.5,
    results: [
      {
        question: "Question one?",
        answer: "Answer one",
        feedback: "Feedback one",
        sample_answer: "Sample one",
        sample_source: "video_reference" as const,
        sample_source_url: "https://youtu.be/abcdefghijk",
        sample_word_count: 62,
        sample_estimated_seconds: 38,
        score: 4,
        level: "Good",
      },
      {
        question: "Question two?",
        answer: "Answer two",
        feedback: "Feedback two",
        sample_answer: "Sample two",
        score: 5,
        level: "Great",
      },
    ],
  };
  render(
    <InterviewResults result={result} onRestart={vi.fn()} onExit={vi.fn()} />,
  );
  expect(screen.getByText("Answer one")).toBeVisible();
  expect(screen.getByText("62 词 · 约 38 秒")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /第 2 题/ }));
  expect(screen.getByText("Answer two")).toBeVisible();
  expect(screen.getByText("Feedback two")).toBeVisible();
  expect(screen.getByText("Sample two")).toBeVisible();
  expect(screen.getByText("2 词 · 约 5 秒")).toBeVisible();
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByRole("link", { name: /参考视频/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Answer one")).not.toBeInTheDocument();
  expect(screen.getByText(/基于转写内容/)).toBeVisible();
  expect(stopSpeaking).toHaveBeenCalled();
});

it.each([
  ["https://www.youtube.com/watch?v=abcdefghijk&t=305", "305", "05:05"],
  ["https://www.youtube.com/watch?v=abcdefghijk&t=30s", "30", "00:30"],
  ["https://youtu.be/abcdefghijk?t=61", "61", "01:01"],
  ["https://www.youtube.com/shorts/abcdefghijk?t=91", "91", "01:31"],
  ["https://www.youtube.com/embed/abcdefghijk?start=120", "120", "02:00"],
  ["https://m.youtube.com/watch?v=abcdefghijk&t=3601", "3601", "1:00:01"],
])("loads the original only after selection at the timestamp in %s", async (sample_source_url, seconds, position) => {
  const user = userEvent.setup();
  const { container } = showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url });
  expect(container.querySelector("iframe")).toBeNull();

  await user.click(screen.getByRole("button", { name: "视频原版" }));

  const player = screen.getByTitle("第 1 题视频原版");
  expect(player).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/abcdefghijk?start=${seconds}`);
  expect(player.getAttribute("allow")).not.toContain("autoplay");
  expect(screen.getByText(new RegExp(`已定位到 ${position}`))).toBeVisible();
  expect(screen.getByRole("link", { name: /打开原视频/ })).toHaveAttribute("href", sample_source_url);
  expect(screen.queryByText(savedAnswer.sample_answer)).not.toBeInTheDocument();
  expect(screen.queryByText(/词 · 约/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "朗读范例" })).not.toBeInTheDocument();
});

it.each(["-30", "1e5", "30&autoplay=1", "0.5", "Infinity", "999999999999999999999"])("never forwards invalid timestamp %s or autoplay parameters to the embed", async (timestamp) => {
  const user = userEvent.setup();
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url: `https://www.youtube.com/watch?v=abcdefghijk&t=${encodeURIComponent(timestamp)}&autoplay=1` });
  await user.click(screen.getByRole("button", { name: "视频原版" }));
  expect(screen.getByTitle("第 1 题视频原版")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abcdefghijk?start=0");
});

it("keeps fallback navigation and the upgrade usable without waiting for the player to load", async () => {
  const user = userEvent.setup();
  const source = "https://youtu.be/abcdefghijk?t=305";
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url: source });
  await user.click(screen.getByRole("button", { name: "视频原版" }));
  expect(screen.getByText(/网络或地区限制可能影响播放/)).toBeVisible();
  // No frame load event: fallback actions must also work for a blocked YouTube request.
  expect(screen.getByTitle("第 1 题视频原版")).toBeInTheDocument();
  const link = screen.getByRole("link", { name: /打开原视频/ });
  expect(link).toHaveAttribute("href", source);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await user.click(screen.getByRole("button", { name: "DeepSeek 升级版" }));
  expect(screen.getByText(savedAnswer.sample_answer)).toBeVisible();
});

it("stops read-aloud on version changes and unloads the original when returning to the upgrade", async () => {
  const user = userEvent.setup();
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url: "https://youtu.be/abcdefghijk?t=30" });
  await user.click(screen.getByRole("button", { name: "朗读范例" }));
  expect(speakText).toHaveBeenCalledWith(savedAnswer.sample_answer);
  vi.mocked(stopSpeaking).mockClear();

  await user.click(screen.getByRole("button", { name: "视频原版" }));
  const player = screen.getByTitle("第 1 题视频原版");
  expect(stopSpeaking).toHaveBeenCalledTimes(1);
  vi.mocked(stopSpeaking).mockClear();

  await user.click(screen.getByRole("button", { name: "DeepSeek 升级版" }));
  expect(player).not.toBeInTheDocument();
  expect(stopSpeaking).toHaveBeenCalledTimes(1);
  expect(screen.getByText(savedAnswer.sample_answer)).toBeVisible();
});

it("unloads a question's original and requires a new explicit selection on the next question", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<InterviewResults result={{ overall: 4, results: [
    { ...savedAnswer, sample_source: "video_reference", sample_source_url: "https://youtu.be/abcdefghijk?t=30" },
    { ...savedAnswer, question: "Question two?", sample_answer: "A different upgrade.", sample_source: "video_reference", sample_source_url: "https://youtu.be/lmnopqrstuv?t=95" },
  ] }} onRestart={vi.fn()} onExit={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "视频原版" }));
  const firstPlayer = screen.getByTitle("第 1 题视频原版");
  vi.mocked(stopSpeaking).mockClear();

  await user.click(screen.getByRole("button", { name: /第 2 题/ }));
  expect(firstPlayer).not.toBeInTheDocument();
  expect(screen.queryByTitle(/视频原版/)).not.toBeInTheDocument();
  expect(screen.getByText("A different upgrade.")).toBeVisible();
  expect(screen.getByRole("button", { name: "DeepSeek 升级版" })).toHaveAttribute("aria-pressed", "true");
  expect(stopSpeaking).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "视频原版" }));
  expect(screen.getByTitle("第 2 题视频原版")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/lmnopqrstuv?start=95");

  vi.mocked(stopSpeaking).mockClear();
  unmount();
  expect(stopSpeaking).toHaveBeenCalledTimes(1);
});
