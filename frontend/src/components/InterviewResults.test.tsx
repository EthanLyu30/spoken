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

it("shows extracted reference notes and the written sample without loading video", () => {
  const { container } = showAnswer({
    ...savedAnswer,
    sample_source: "video_reference",
    sample_source_url: "https://www.youtube.com/watch?v=abcdefghijk&t=30s",
    sample_word_count: 65,
    sample_estimated_seconds: 39,
    reference_notes: "A concrete reason and one small example.",
  });
  expect(screen.getByText("65 词 · 约 39 秒")).toBeVisible();
  expect(screen.getByText(/110 词\/分钟.*4 秒停顿.*估算/)).toBeVisible();
  expect(screen.getByText("参考思路 · AI 改写")).toBeVisible();
  expect(screen.getByText("参考思路要点")).toBeVisible();
  expect(screen.getByText("A concrete reason and one small example.")).toBeVisible();
  expect(screen.getByText(savedAnswer.sample_answer)).toBeVisible();
  expect(container.querySelector("iframe")).toBeNull();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "视频原版" })).not.toBeInTheDocument();
});

it.each([
  "https://www.youtube.com/watch?v=abcdefghijk&t=30s",
  "javascript:alert(1)",
  "https://youtu.be/abcdefghijk",
])("ignores saved video source %s", (sample_source_url) => {
  const { container } = showAnswer({
    ...savedAnswer,
    sample_source: "video_reference",
    sample_source_url,
  });
  expect(container.querySelector("iframe")).toBeNull();
  expect(screen.queryByText(/打开原视频/)).not.toBeInTheDocument();
  expect(screen.getByText("参考思路 · AI 改写")).toBeVisible();
});

it("shows the new five-point content rubric without claiming audio or official bands", async () => {
  render(<InterviewResults result={{ overall: 4, results: [savedAnswer], score_max: 5, scoring_version: "ets-interview-text-v1", scoring_basis: "transcript" }} onRestart={vi.fn()} onExit={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "内容参考分" })).toBeVisible();
  expect(screen.getAllByText("/ 5")).toHaveLength(2);
  await userEvent.setup().click(screen.getByText("查看 0–5 分评分标准"));
  for (let score = 0; score <= 5; score++) expect(screen.getByText(`${score} 分`)).toBeVisible();
  expect(screen.getByText(/未评估发音、停顿和流利度/)).toBeVisible();
  expect(screen.getByRole("link", { name: "ETS 官方评分标准" })).toHaveAttribute("href", "https://www.ets.org/content/dam/ets-org/pdfs/toefl/speaking-rubrics.pdf");
});

it("labels old saved scores with their original six-point scale", () => {
  showAnswer({ ...savedAnswer, score: 6 });
  expect(screen.getByRole("heading", { name: "旧版练习参考分" })).toBeVisible();
  expect(screen.getAllByText("/ 6")).toHaveLength(2);
  expect(screen.queryByText("查看 0–5 分评分标准")).not.toBeInTheDocument();
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
        reference_notes: "First note.",
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
  render(<InterviewResults result={result} onRestart={vi.fn()} onExit={vi.fn()} />);
  expect(screen.getByText("Answer one")).toBeVisible();
  expect(screen.getByText("First note.")).toBeVisible();
  expect(screen.getByText("62 词 · 约 38 秒")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /第 2 题/ }));
  expect(screen.getByText("Answer two")).toBeVisible();
  expect(screen.getByText("Feedback two")).toBeVisible();
  expect(screen.getByText("Sample two")).toBeVisible();
  expect(screen.getByText("2 词 · 约 5 秒")).toBeVisible();
  expect(screen.getByText("AI 口语示例")).toBeVisible();
  expect(screen.queryByText("First note.")).not.toBeInTheDocument();
  expect(screen.queryByText("Answer one")).not.toBeInTheDocument();
  expect(screen.getByText(/基于转写内容/)).toBeVisible();
  expect(stopSpeaking).toHaveBeenCalled();
});

it("stops read-aloud when unmounting", () => {
  const { unmount } = showAnswer({ ...savedAnswer, sample_source: "video_reference" });
  vi.mocked(stopSpeaking).mockClear();
  unmount();
  expect(stopSpeaking).toHaveBeenCalledTimes(1);
});
