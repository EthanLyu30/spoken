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
  const source = screen.getByRole("link", { name: "参考视频思路 · AI 改写" });
  expect(source).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk&t=30s");
  expect(source).toHaveAttribute("rel", "noopener noreferrer");
});

it.each([
  "javascript:alert(1)", "http://www.youtube.com/watch?v=abcdefghijk",
  "https://www.youtube.com.evil.test/watch?v=abcdefghijk", "https://youtube.com@evil.test/watch?v=abcdefghijk",
  "https://www.youtube.com/playlist?list=abcdefghijk", "https://youtu.be/", "https://www.youtube.com/watch?v=bad",
  "https://user:pass@www.youtube.com/watch?v=abcdefghijk", "https://www.youtube.com:8443/watch?v=abcdefghijk",
])("does not label unsafe or non-video source %s as a video reference", (sample_source_url) => {
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url });
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByRole("link", { name: /参考视频/ })).not.toBeInTheDocument();
});

it.each(["https://youtu.be/abcdefghijk", "https://www.youtube.com/shorts/abcdefghijk"])("accepts a valid alternate YouTube video URL %s", (sample_source_url) => {
  showAnswer({ ...savedAnswer, sample_source: "video_reference", sample_source_url });
  expect(screen.getByRole("link", { name: "参考视频思路 · AI 改写" })).toHaveAttribute("href", sample_source_url);
});

it("keeps AI provenance even when an AI sample includes a video URL", () => {
  showAnswer({ ...savedAnswer, sample_source: "ai_generated", sample_source_url: "https://youtu.be/abcdefghijk" });
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("estimates missing metadata for old history and keeps playback and navigation usable", async () => {
  const user = userEvent.setup();
  const exit = vi.fn();
  const restart = vi.fn();
  render(<InterviewResults result={{ overall: 4, results: [savedAnswer] }} onRestart={restart} onExit={exit} exitLabel="回历史记录" />);
  expect(screen.getByText("9 词 · 约 9 秒")).toBeVisible();
  expect(screen.getByText("AI 口语示例")).toBeVisible();
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
