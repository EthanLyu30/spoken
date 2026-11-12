import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const direct = vi.hoisted(() => ({ transcribe: vi.fn(), open: vi.fn() }));
vi.mock("./directAsr", () => ({ transcribeDirect: direct.transcribe, openDirectAsrStream: direct.open }));
import { postAsr } from "./api";
import { openAsrStream } from "./asrStream";
import { MAX_AUDIO_BYTES } from "./audioLimits";
import { AsrProviderError, AsrQuotaError, isAsrQuotaCooling, markAsrQuota, resetAsrQuotaForTest } from "./asrQuota";
import { bindInteraction } from "./telemetry";
import type { AsrStreamCallbacks } from "./asrStream";

describe("cloud ASR routing", () => {
  beforeEach(() => { direct.transcribe.mockReset(); direct.open.mockReset(); resetAsrQuotaForTest(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { resetAsrQuotaForTest(); vi.unstubAllGlobals(); });

  it("uses a successful direct transcript without uploading the recording to the relay", async () => {
    direct.transcribe.mockResolvedValue("complete direct transcript");
    const onTransport = vi.fn();
    expect(await postAsr(new ArrayBuffer(1280), undefined, onTransport)).toBe("complete direct transcript");
    expect(onTransport).toHaveBeenLastCalledWith("direct");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  });

  it("preserves the whole clip when direct transcription needs the relay fallback", async () => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: "complete relay transcript" })));
    const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
    const onTransport = vi.fn();
    expect(await postAsr(pcm, undefined, onTransport)).toBe("complete relay transcript");
    expect(onTransport).toHaveBeenLastCalledWith("buffered");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/asr"), expect.objectContaining({ body: pcm }));
  });

  it("stops after an HTTP 11201 quota failure and does not upload again", async () => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: "iFlytek ASR error 11201: licc failed" }), { status: 503 }));
    const asrFetches = () => vi.mocked(fetch).mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url))).length;
    await expect(postAsr(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(asrFetches()).toBe(1);
    const directCalls = direct.transcribe.mock.calls.length;
    await expect(postAsr(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(direct.transcribe).toHaveBeenCalledTimes(directCalls);
    expect(asrFetches()).toBe(1);
  });

  it("rechecks quota before HTTP after a concurrent quota failure", async () => {
    let reject!: (error: Error) => void;
    direct.transcribe.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const opening = postAsr(new ArrayBuffer(1280));
    await vi.waitFor(() => expect(direct.transcribe).toHaveBeenCalledOnce());
    markAsrQuota("another request hit 11201");
    reject(new Error("network"));
    await expect(opening).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it("rechecks quota before opening relay after a concurrent quota failure", async () => {
    let reject!: (error: Error) => void;
    direct.open.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const socket = vi.fn(function () { throw new Error("Unexpected relay socket"); });
    vi.stubGlobal("WebSocket", socket);
    const opening = openAsrStream({ onPartial: vi.fn() });
    await vi.waitFor(() => expect(direct.open).toHaveBeenCalledOnce());
    markAsrQuota("another request hit 11201");
    reject(new Error("network"));
    await expect(opening).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(socket).not.toHaveBeenCalled();
  });

  it("does not fall back to HTTP when the direct whole-clip is quota-blocked", async () => {
    direct.transcribe.mockRejectedValue(new AsrQuotaError());
    await expect(postAsr(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it.each([10005, 11200])("preserves HTTP provider code %s without quota cooling", async (code) => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ detail: `iFlytek ASR error ${code}: provider rejected` }), { status: 503 }));
    await expect(postAsr(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AsrProviderError", providerCode: code });
    expect(isAsrQuotaCooling()).toBe(false);
  });

  it("keeps the HTTP deadline as a timeout even when fetch rejects with AbortError", async () => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const signal = new AbortController().signal;
    bindInteraction(signal, "a".repeat(32));
    vi.mocked(fetch).mockImplementation(async url => {
      if (String(url).endsWith("/api/asr")) {
        deadline.abort(new DOMException("Recognition deadline", "TimeoutError"));
        throw new DOMException("fetch aborted", "AbortError");
      }
      return new Response(null, { status: 202 });
    });
    try {
      await expect(postAsr(new ArrayBuffer(1280), signal)).rejects.toMatchObject({ name: "TimeoutError" });
      const samples = vi.mocked(fetch).mock.calls
        .filter(([url]) => String(url).endsWith("/api/telemetry/client"))
        .map(([, init]) => JSON.parse(String(init?.body)));
      expect(samples).toContainEqual(expect.objectContaining({
        stage: "http_buffered", outcome: "timeout", asr_reason: "timeout", interaction_id: "a".repeat(32),
      }));
    } finally { timeout.mockRestore(); }
  });

  it("records a provider failure during live capture even if finalize never runs", async () => {
    let callbacks!: AsrStreamCallbacks;
    direct.open.mockImplementation(async (cb: AsrStreamCallbacks) => {
      callbacks = cb;
      return { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn() };
    });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 202 }));
    const signal = new AbortController().signal;
    bindInteraction(signal, "a".repeat(32));
    const stream = await openAsrStream({ onPartial: vi.fn() }, "en_us", signal);
    bindInteraction(stream, "b".repeat(32));
    stream.send(new ArrayBuffer(1280));
    callbacks.onClose?.(new AsrProviderError(10005, "private provider details"));
    const samples = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(samples).toContainEqual(expect.objectContaining({
      operation: "asr.attempt", stage: "stream", outcome: "error", asr_reason: "provider_error",
      provider_code: 10005, interaction_id: "b".repeat(32),
    }));
    expect(JSON.stringify(samples)).not.toContain("private provider details");
  });

  it("does not upload a cancelled utterance to either transport", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(postAsr(new ArrayBuffer(1280), controller.signal)).rejects.toThrow();
    expect(direct.transcribe).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  });

  it("does not retry an explicit empty direct final over HTTP", async () => {
    direct.transcribe.mockResolvedValue("");
    expect(await postAsr(new ArrayBuffer(1280))).toBe("");
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  });

  it("rejects oversized audio before any direct or backend request", async () => {
    await expect(postAsr(new ArrayBuffer(MAX_AUDIO_BYTES + 1))).rejects.toThrow("180 seconds");
    expect(direct.transcribe).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  });

  it("selects the direct streaming connection when it is available", async () => {
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockResolvedValue("direct transcript") };
    direct.open.mockResolvedValue(stream);
    const selected = await openAsrStream({ onPartial: vi.fn() });
    expect(selected.transport).toBe("direct");
    const pcm = new ArrayBuffer(16);
    selected.send(pcm);
    expect(await selected.finishUtterance()).toBe("direct transcript");
    selected.close();
    expect(stream.send).toHaveBeenCalledWith(pcm);
    expect(stream.close).toHaveBeenCalledOnce();
    expect(stream.finishUtterance).toHaveBeenCalledOnce();
  });
});

it("does not upload to the relay after a pending direct attempt fails across A to B to A", async () => {
  const { setToken } = await import("./authToken");
  setToken("asr-a");
  let reject!: (error: Error) => void;
  direct.transcribe.mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "wrong owner" }))));
  const checked = expect(postAsr(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AbortError" });
  setToken("asr-b"); setToken("asr-a"); reject(new Error("network"));
  await checked;
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  vi.unstubAllGlobals();
});

it("does not open a relay socket after a direct handshake fails under an obsolete identity", async () => {
  const { setToken } = await import("./authToken");
  setToken("asr-stream-a");
  let reject!: (error: Error) => void;
  direct.open.mockReturnValue(new Promise((_resolve, r) => { reject = r; }));
  const socket = vi.fn(function () { throw new Error("Unexpected relay socket"); });
  vi.stubGlobal("WebSocket", socket);
  const checked = expect(openAsrStream({ onPartial: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
  setToken("asr-stream-b"); reject(new Error("network"));
  await checked;
  expect(socket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("does not treat direct cancellation as a reason to try the relay", async () => {
  const abort = new DOMException("Cancelled", "AbortError");
  direct.transcribe.mockRejectedValue(abort);
  vi.stubGlobal("fetch", vi.fn());
  await expect(postAsr(new ArrayBuffer(1280))).rejects.toBe(abort);
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toHaveLength(0);
  vi.unstubAllGlobals();
});
it("does not open a relay socket after a direct quota failure", async () => {
  direct.open.mockRejectedValue(new AsrQuotaError());
  const socket = vi.fn(function () { throw new Error("Unexpected relay socket"); });
  vi.stubGlobal("WebSocket", socket);
  await expect(openAsrStream({ onPartial: vi.fn() })).rejects.toMatchObject({ name: "AsrQuotaError" });
  expect(socket).not.toHaveBeenCalled();
});

it("keeps same-owner streaming relay fallback available after a direct failure", async () => {
  direct.open.mockRejectedValue(new Error("direct unavailable"));
  const frames: unknown[] = [];
  vi.stubGlobal("WebSocket", class {
    static OPEN = 1;
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    constructor() { queueMicrotask(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ type: "ready" }) }); }); }
    send(value: unknown) { frames.push(value); }
    close() { this.readyState = 3; this.onclose?.(); }
  });
  const stream = await openAsrStream({ onPartial: vi.fn() });
  expect(stream.transport).toBe("relay");
  const pcm = new ArrayBuffer(1280);
  stream.send(pcm); stream.close();
  expect(frames).toContain(pcm);
  vi.unstubAllGlobals();
});
