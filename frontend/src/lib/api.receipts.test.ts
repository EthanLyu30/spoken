import { afterEach, expect, it, vi } from "vitest";
import { savePractice, reviewWord, postSession } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("uses keepalive only for an explicitly exiting session within the UTF-8 byte budget", async () => {
  const calls: RequestInit[] = [];
  vi.stubGlobal("fetch", async (_url:string, init:RequestInit) => { calls.push(init); return new Response("{}"); });
  const payload={scenario_id:"interview", messages:[{role:"user" as const,content:"I coordinated the rollout."}],
    overall:null,summary:"",tip:"",scores:[],client_session_id:"receipt-exit"};
  await postSession(payload);
  await postSession(payload,undefined,true);
  await postSession({...payload,messages:Array.from({length:30},()=>({role:"user" as const,content:"讲".repeat(1000)}))},undefined,true);
  expect(calls.map(call=>Boolean(call.keepalive))).toEqual([false,true,false]);
  expect(calls.map(call=>JSON.parse(String(call.body)).client_session_id)).toEqual(["receipt-exit","receipt-exit","receipt-exit"]);
});
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

it("sends the original word timestamp with its full precision and rating receipt", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const createdAt = "2026-11-25T11:45:10.123456";
  await reviewWord(1, "uncertain", undefined, "word-rating", createdAt);
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
    remembered: false, uncertain: true, client_request_id: "word-rating", created_at: createdAt,
  });
});
