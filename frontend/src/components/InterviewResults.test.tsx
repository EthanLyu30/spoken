import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { InterviewResults } from "./InterviewResults";
vi.mock("../lib/speech", () => ({ speakText: vi.fn(), stopSpeaking: vi.fn() }));
import { stopSpeaking } from "../lib/speech";

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
  await user.click(screen.getByRole("button", { name: /第 2 题/ }));
  expect(screen.getByText("Answer two")).toBeVisible();
  expect(screen.getByText("Feedback two")).toBeVisible();
  expect(screen.getByText("Sample two")).toBeVisible();
  expect(screen.queryByText("Answer one")).not.toBeInTheDocument();
  expect(screen.getByText(/基于转写内容/)).toBeVisible();
  expect(stopSpeaking).toHaveBeenCalled();
});
