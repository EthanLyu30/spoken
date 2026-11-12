import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as telemetry from "./telemetry";

const prefix = "spoken-asr-telemetry:v1:";
const id = "a".repeat(32);
const pending = () => Object.keys(localStorage).filter(key => key.startsWith(prefix));
const stored = () => new Response(null, { status: 202, headers: { "X-Telemetry-Stored": "1" } });
const offline = () => vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
const testRun = globalThis as { __TEST_RUN_ID__?: string };
let stop: (() => void) | undefined;

function start() {
  stop = telemetry.initializeAsrTelemetryRecovery();
}

function reportFailure() {
  const diagnostics = { outcome: "error", engine: "xfyun", transport: "direct", asr_reason: "provider_error",
    provider_code: 10005, interactionId: id, transcript: "private answer", audio: "private audio" } as const;
  telemetry.reportTiming("asr.transcribe", 610, diagnostics);
}

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => {
  stop?.();
  stop = undefined;
  delete testRun.__TEST_RUN_ID__;
  localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("saves the failure before sending and automatically retries when the browser comes online", async () => {
  const online = offline();
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  expect(fetcher).not.toHaveBeenCalled();
  expect(pending()).toHaveLength(1);
  expect(localStorage.getItem(pending()[0])).not.toMatch(/private answer|private audio/);
  online.mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  const init = fetcher.mock.calls[0][1];
  expect(JSON.parse(init.body)).toMatchObject({
    operation: "asr.transcribe", outcome: "error", asr_reason: "provider_error",
    provider_code: 10005, interaction_id: id, event_id: expect.stringMatching(/^[a-f0-9]{32}$/), is_replay: true,
  });
  expect(init.credentials).toBe("omit");
  expect(pending()).toHaveLength(0);
});

it("reopens a queued failure with the same id and original test batch after an interrupted upload", async () => {
  const firstFetch = vi.fn().mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", firstFetch);
  testRun.__TEST_RUN_ID__ = "before-close";
  start();
  reportFailure();
  expect(firstFetch).toHaveBeenCalledOnce();
  expect(pending()).toHaveLength(1);
  const first = JSON.parse(firstFetch.mock.calls[0][1].body);

  stop?.();
  testRun.__TEST_RUN_ID__ = "after-reopen";
  const nextFetch = vi.fn().mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", nextFetch);
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(nextFetch).toHaveBeenCalledOnce();
  const replay = JSON.parse(nextFetch.mock.calls[0][1].body);
  expect(first.is_replay).toBe(false);
  expect(replay).toEqual({ ...first, is_replay: true });
  expect(replay.test_run_id).toBe("before-close");
  expect(pending()).toHaveLength(0);
});

it("preserves the failure timestamp across Beijing midnight and a schema rollout", async () => {
  const occurred = new Date("2026-11-12T23:50:00+08:00");
  vi.setSystemTime(occurred);
  const online = offline();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 422 }))
    .mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  expect(fetcher).not.toHaveBeenCalled();
  stop?.();

  vi.setSystemTime(new Date("2026-11-13T00:55:00+08:00"));
  online.mockReturnValue(true);
  start();
  await vi.advanceTimersByTimeAsync(0);
  expect(pending()).toHaveLength(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    occurred_at_ms: occurred.getTime(), interaction_id: id, provider_code: 10005,
  });
  await vi.advanceTimersByTimeAsync(750);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  expect(pending()).toHaveLength(0);
});

it("retains the same event through a network error and a queue-only 202", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("network error"))
    .mockResolvedValueOnce(new Response(null, { status: 202 }))
    .mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  await vi.advanceTimersByTimeAsync(0);
  expect(pending()).toHaveLength(1);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(pending()).toHaveLength(1);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [first, retry, confirmed] = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(first.is_replay).toBe(false);
  expect(retry).toEqual({ ...first, is_replay: true });
  expect(confirmed).toEqual(retry);
  expect(pending()).toHaveLength(0);
});

it("honors Retry-After for a stored failure even when an online event fires", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "2" } }))
    .mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  await vi.advanceTimersByTimeAsync(0);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(pending()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [first, retry] = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(first.is_replay).toBe(false);
  expect(retry).toEqual({ ...first, is_replay: true });
  expect(pending()).toHaveLength(0);
});

it("caps pending failures and drops them after their retention window", () => {
  offline();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  start();
  localStorage.setItem("unrelated", "keep");
  for (let i = 0; i < 65; i++) {
    vi.setSystemTime(Date.now() + 1);
    telemetry.reportTiming("asr.finalize", i, { outcome: "timeout", asr_reason: "timeout" });
  }
  expect(pending()).toHaveLength(64);
  expect(pending().map(key => JSON.parse(localStorage.getItem(key)!).payload.duration_ms)).not.toContain(0);
  stop?.();
  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
  start();
  expect(pending()).toHaveLength(0);
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(fetcher).not.toHaveBeenCalled();
});

it("can still report a failure if local storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("disabled", "QuotaExceededError"); });
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(pending()).toHaveLength(0);
});

it("does not mark healthy first attempts queued behind another online delivery as replays", async () => {
  let confirm!: (response: Response) => void;
  const first = new Promise<Response>(resolve => { confirm = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(first).mockImplementation(() => Promise.resolve(stored()));
  vi.stubGlobal("fetch", fetcher);
  start();
  reportFailure();
  reportFailure();
  expect(fetcher).toHaveBeenCalledOnce();
  confirm(stored());
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).is_replay)).toEqual([false, false]);
  expect(pending()).toHaveLength(0);
});
