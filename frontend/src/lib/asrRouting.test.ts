import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const direct = vi.hoisted(() => ({ transcribe: vi.fn(), open: vi.fn() }));
vi.mock("./directAsr", () => ({ transcribeDirect: direct.transcribe, openDirectAsrStream: direct.open }));
import { postAsr } from "./api";
import { openAsrStream } from "./asrStream";

describe("cloud ASR routing", () => {
  beforeEach(() => { direct.transcribe.mockReset(); direct.open.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it("uses a successful direct transcript without uploading the recording to the relay", async () => {
    direct.transcribe.mockResolvedValue("complete direct transcript");
    expect(await postAsr(new ArrayBuffer(1280))).toBe("complete direct transcript");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the whole clip when direct transcription needs the relay fallback", async () => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: "complete relay transcript" })));
    const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(await postAsr(pcm)).toBe("complete relay transcript");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/asr"), expect.objectContaining({ body: pcm }));
  });

  it("does not upload a cancelled utterance to either transport", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(postAsr(new ArrayBuffer(1280), controller.signal)).rejects.toThrow();
    expect(direct.transcribe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects the direct streaming connection when it is available", async () => {
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockResolvedValue("direct transcript") };
    direct.open.mockResolvedValue(stream);
    const selected = await openAsrStream({ onPartial: vi.fn() });
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
  expect(fetch).not.toHaveBeenCalled();
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
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
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
  const pcm = new ArrayBuffer(1280);
  stream.send(pcm); stream.close();
  expect(frames).toContain(pcm);
  vi.unstubAllGlobals();
});
