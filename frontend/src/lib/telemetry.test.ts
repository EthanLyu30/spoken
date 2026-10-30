import { afterEach, expect, it, vi } from "vitest";
import { reportTiming, measureAsrStream, bindInteraction, getInteraction, traceHeaders } from "./telemetry";

afterEach(() => vi.unstubAllGlobals());

it("submits only bounded numeric timing and declared metadata, never business content", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  reportTiming("asr.finalize", 920, { engine: "xfyun", transport: "direct" });
  expect(fetcher).toHaveBeenCalledOnce();
  const [, options] = fetcher.mock.calls[0];
  expect(JSON.parse(options.body)).toEqual({ operation: "asr.finalize", duration_ms: 920, outcome: "ok", engine: "xfyun", transport: "direct", release: "development" });
  expect(options.headers).not.toHaveProperty("Authorization");
  reportTiming("asr.finalize", Number.NaN);
  reportTiming("asr.finalize", -1);
  reportTiming("asr.finalize", 300001);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("telemetry network failures never change a successful ASR result", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const wrapped = measureAsrStream({ send() {}, close() {}, finishUtterance: async () => "a private transcript" }, "direct");
  expect(await wrapped.finishUtterance()).toBe("a private transcript");
});

it("records a failed finalization while preserving the original exception", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  const error = new Error("original ASR failure");
  const wrapped = measureAsrStream({ send() {}, close() {}, finishUtterance: async () => { throw error; } }, "relay");
  await expect(wrapped.finishUtterance()).rejects.toBe(error);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).outcome).toBe("error");
});

it("keeps concurrent turn identities scoped to their own cancellation signals", () => {
  const first = new AbortController(), second = new AbortController();
  bindInteraction(first.signal, "a".repeat(32));
  bindInteraction(second.signal, "b".repeat(32));
  expect(getInteraction(first.signal)).toBe("a".repeat(32));
  expect(traceHeaders(second.signal)).toEqual({ "X-Interaction-Id": "b".repeat(32) });
  expect(traceHeaders(new AbortController().signal)).toEqual({});
});
