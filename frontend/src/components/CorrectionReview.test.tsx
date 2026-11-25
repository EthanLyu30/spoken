import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage, Correction } from "../lib/api";
import { CorrectionReview } from "./CorrectionReview";
import { DictionaryContext } from "./dictionary/DictionaryContext";

afterEach(() => vi.unstubAllGlobals());

it("keeps legacy favorites for reading and opens practice only for the chosen correction", async () => {
  const savedLine = "I really liked the talk on sales theory in the media.";
  const messages: ChatMessage[] = [
    { role: "user", content: savedLine },
    { role: "assistant", content: "Who did you come to meet?" },
    { role: "user", content: "Yesterday I come to speak peer sales." },
  ];
  const favorite: Correction = { original: savedLine, suggestion: "", note: "", turn_index: 0, marked: true, self_marked: true };
  const tense: Correction = { original: "come", suggestion: "came", note: "用过去式。", category: "tense", turn_index: 2 };
  const phrase: Correction = { original: "speak peer sales", suggestion: "speak with peers in sales", note: "用 speak with。", category: "word_choice", turn_index: 2 };
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const { marked } = JSON.parse(String(init.body));
    return new Response(JSON.stringify([favorite, tense, { ...phrase, marked }]));
  });
  vi.stubGlobal("fetch", fetcher);
  const user = userEvent.setup();
  const createdAt = "2026-11-25T07:08:09.123456";
  function Review() {
    const [fixes, setFixes] = useState([favorite, tense, phrase]);
    return <DictionaryContext.Provider value={{ openDictionary: () => {} }}>
      <CorrectionReview corrections={fixes} messages={messages} scenarioId="work" sessionId={52} sessionCreatedAt={createdAt} onCorrectionsChange={setFixes} />
    </DictionaryContext.Provider>;
  }
  render(<Review />);

  const [saved, corrected] = screen.getAllByRole("listitem");
  expect(saved).toHaveTextContent(savedLine);
  expect(within(saved).getByText("已收藏")).toBeVisible();
  expect(within(saved).queryByRole("button", { name: /复练|填空|中译英/ })).not.toBeInTheDocument();
  expect(within(corrected).queryByRole("button", { name: "填空" })).not.toBeInTheDocument();
  const [chooseTense, choosePhrase] = within(corrected).getAllByRole("button", { name: "加入复练" });
  await user.click(choosePhrase);
  expect(await within(corrected).findByText("已加入复练")).toBeVisible();
  expect(chooseTense).toBeEnabled();
  expect(fetcher).toHaveBeenCalledWith("/api/sessions/52/corrections/practice", expect.objectContaining({ method: "PATCH" }));
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({ created_at: createdAt, original: phrase.original, marked: true });
  await user.click(within(corrected).getByRole("button", { name: "填空" }));
  expect(within(corrected).getByRole("region", { name: "填空练习" })).toBeVisible();
  await user.click(within(corrected).getByRole("button", { name: "移出复练" }));
  expect(within(corrected).queryByRole("region", { name: "填空练习" })).not.toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body))).toMatchObject({ created_at: createdAt, original: phrase.original, marked: false });
});
