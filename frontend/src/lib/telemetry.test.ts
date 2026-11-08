import { afterEach, expect, it, vi } from "vitest";
import { reportTiming, measureAsrStream, bindInteraction, getInteraction, traceHeaders } from "./telemetry";

afterEach(() => { delete (globalThis as { __TEST_RUN_ID__?: string }).__TEST_RUN_ID__; vi.unstubAllGlobals(); });

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

it("retries a rejected playback diagnostic once in the legacy format", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 422 }))
    .mockResolvedValueOnce(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  const interactionId = "a".repeat(32);
  reportTiming("speech.complete", 200, { engine: "browser", interactionId, playback_started: true, reason: "end_before_start" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const [first, second] = fetcher.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(first).toMatchObject({ playback_started: true, reason: "end_before_start" });
  expect(second).toMatchObject({ operation: "speech.complete", duration_ms: 200, outcome: "ok", interaction_id: interactionId });
  expect(second).not.toHaveProperty("playback_started");
  expect(second).not.toHaveProperty("reason");
});

it("carries the automation test run and provider code without content", async () => {
  (globalThis as { __TEST_RUN_ID__?: string }).__TEST_RUN_ID__ = "run-2026-11-08";
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  const error = Object.assign(new Error("quota"), { providerCode: 11201, name: "AsrQuotaError" });
  const wrapped = measureAsrStream({ send() {}, close() {}, finishUtterance: async () => { throw error; } }, "direct");
  await expect(wrapped.finishUtterance()).rejects.toBe(error);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.test_run_id).toBe("run-2026-11-08");
  expect(body.provider_code).toBe(11201);
  expect(traceHeaders()).toEqual({ "X-Test-Run-Id": "run-2026-11-08" });
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

it("reports an explicitly closed pending ASR finalization as cancelled without changing its empty result", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  let settle: (text: string) => void = () => {};
  const measured = measureAsrStream({ send() {}, close: () => settle(""), finishUtterance: () => new Promise(resolve => { settle = resolve; }) }, "relay");
  const pending = measured.finishUtterance();
  measured.close();
  expect(await pending).toBe("");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).outcome).toBe("cancelled");
});

it("recognizes direct-provider signal cancellation even when the raw stream resolves empty", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  let settle: (text: string) => void = () => {};
  const measured = measureAsrStream({ send() {}, close() {}, finishUtterance: () => new Promise(resolve => { settle = resolve; }) }, "direct", controller.signal);
  controller.signal.addEventListener("abort", () => settle(""));
  const pending = measured.finishUtterance(); controller.abort();
  expect(await pending).toBe("");
  expect(JSON.parse(fetcher.mock.calls[0][1].body).outcome).toBe("cancelled");
});


it("accepts long native terminal timings without relaxing other operations", () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  reportTiming("speech.native_end", 300_001, { reason: "completion_timeout" });
  reportTiming("speech.complete", 300_001);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ operation: "speech.native_end", duration_ms: 300_001 });
});

it("whitelists native diagnostics and never forwards unknown fields or native fields on other operations", () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, {status:202})); vi.stubGlobal("fetch",fetcher);
  const options = {reason: "started", state_before: 1, state_after: 7, voice_type: "enhanced", voice_matched: true, error_code: "network", private_name: "Secret voice"} as const;
  reportTiming("speech.native_start", 100, options);
  const sample = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(sample).toMatchObject({reason:"started",state_before:1,state_after:7,voice_type:"enhanced",voice_matched:true,error_code:"network"});
  expect(sample).not.toHaveProperty("private_name");
  reportTiming("speech.complete",100,options);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).not.toHaveProperty("reason");
});
