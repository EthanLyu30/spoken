import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postPronunciation, postTurnCorrection } from "../lib/api";
import { TurnCorrectionCard } from "./TurnCorrectionCard";

vi.mock("../lib/api", () => ({
  postTurnCorrection: vi.fn(),
  postPronunciation: vi.fn(),
}));

vi.mock("../lib/speech", () => ({
  speakText: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })),
}));

const correction = {
  original: "I very like it",
  natural: false,
  suggestion: "I really like it.",
  issues: [
    {
      kind: "grammar" as const,
      original: "very like",
      replacement: "really like",
      note: "用 really 修饰动词。",
    },
  ],
  explanation: "换一个副词会更自然。",
};

const pronunciation = {
  overall: 78,
  accuracy: 80,
  fluency: 76,
  integrity: 90,
  standard: 75,
  words: [
    {
      word: "like",
      score: 62,
      phonemes: [{ label: "ay", ok: false }],
    },
  ],
};

describe("TurnCorrectionCard", () => {
  beforeEach(() => {
    vi.mocked(postTurnCorrection).mockReset();
    vi.mocked(postPronunciation).mockReset();
    vi.mocked(postTurnCorrection).mockResolvedValue(correction);
    vi.mocked(postPronunciation).mockResolvedValue(pronunciation);
  });

  it("checks text only for a typed turn and caches the result", async () => {
    const user = userEvent.setup();
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage="How is it?"
        meta={{ source: "typed" }}
        onUseSuggestion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "即时纠错" }));

    expect(await screen.findByText("I really like it.")).toBeInTheDocument();
    expect(screen.getByText("本句为文字输入，无法评测发音")).toBeInTheDocument();
    expect(postPronunciation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "收起即时纠错" }));
    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    expect(postTurnCorrection).toHaveBeenCalledTimes(1);
  });

  it("checks text and pronunciation for a voice turn", async () => {
    const user = userEvent.setup();
    const pcm = new ArrayBuffer(8);
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage="How is it?"
        meta={{ source: "voice", spokenText: "I very like it", pcm }}
        onUseSuggestion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "即时纠错" }));

    expect(await screen.findByText("发音参考")).toBeInTheDocument();
    expect(screen.getByText("78")).toBeInTheDocument();
    expect(postPronunciation).toHaveBeenCalledWith("I very like it", pcm);
  });

  it("assesses only the spoken fragment for mixed input", async () => {
    const user = userEvent.setup();
    const pcm = new ArrayBuffer(8);
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="Could I get I very like it"
        previousPartnerMessage="What would you like?"
        meta={{ source: "mixed", spokenText: "I very like it", pcm }}
        onUseSuggestion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    await screen.findByText("发音参考");

    expect(postTurnCorrection).toHaveBeenCalledWith({
      scenario_id: "cafe",
      text: "Could I get I very like it",
      previous_partner_message: "What would you like?",
      custom: undefined,
    });
    expect(postPronunciation).toHaveBeenCalledWith("I very like it", pcm);
    expect(screen.getByText("评测语音片段：I very like it")).toBeInTheDocument();
  });

  it("keeps text correction visible when pronunciation fails", async () => {
    vi.mocked(postPronunciation).mockRejectedValue(new Error("ISE down"));
    const user = userEvent.setup();
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage=""
        meta={{
          source: "voice",
          spokenText: "I very like it",
          pcm: new ArrayBuffer(8),
        }}
        onUseSuggestion={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "即时纠错" }));

    expect(await screen.findByText("I really like it.")).toBeInTheDocument();
    expect(screen.getByText("发音评测失败，可单独重试")).toBeInTheDocument();
  });

  it("places the recommended sentence back into the composer", async () => {
    const onUseSuggestion = vi.fn();
    const user = userEvent.setup();
    render(
      <TurnCorrectionCard
        scenarioId="cafe"
        text="I very like it"
        previousPartnerMessage=""
        meta={{ source: "typed" }}
        onUseSuggestion={onUseSuggestion}
      />,
    );

    await user.click(screen.getByRole("button", { name: "即时纠错" }));
    await user.click(await screen.findByRole("button", { name: "放入输入框" }));

    expect(onUseSuggestion).toHaveBeenCalledWith("I really like it.");
  });
});
