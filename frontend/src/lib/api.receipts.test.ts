import { afterEach, expect, it, vi } from "vitest";
import { savePractice, reviewWord } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("sends optional practice and review receipts without changing legacy signal positions", async () => {
  const requests: {
    body: Record<string, unknown>;
    signal: AbortSignal;
  }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(init.body as string), signal: init.signal as AbortSignal });
    return new Response("{}");
  }));
  const controller = new AbortController();
  await savePractice("interview", 4, "title", "detail", controller.signal, "practice-once");
  await reviewWord(1, true, controller.signal, "review-once");
  await savePractice("pronunciation", 90);
  await reviewWord(1, false);
  expect(requests.map(request => request.body)).toEqual([
    { kind: "interview", score: 4, title: "title", detail: "detail", client_request_id: "practice-once" },
    { remembered: true, client_request_id: "review-once" },
    { kind: "pronunciation", score: 90, title: "", detail: "" },
    { remembered: false },
  ]);
  controller.abort();
  expect(requests[0].signal.aborted).toBe(true);
  expect(requests[1].signal.aborted).toBe(true);
});
