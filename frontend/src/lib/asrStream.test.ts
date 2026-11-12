import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRelayAsrStream } from "./asrStream";
import { setToken } from "./authToken";
import { bindInteraction } from "./telemetry";
import { isAsrQuotaCooling, resetAsrQuotaForTest } from "./asrQuota";

class Socket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: unknown[] = [];

  constructor(_url: string) { Socket.instances.push(this); }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = Socket.CLOSED; this.onclose?.(); }
  message(payload: unknown) { this.onmessage?.({ data: JSON.stringify(payload) }); }
}

async function ready(onClose = vi.fn()) {
  const opening = openRelayAsrStream({ onPartial: vi.fn(), onClose });
  const socket = Socket.instances.at(-1)!;
  socket.onopen?.();
  socket.message({ type: "ready" });
  return { stream: await opening, socket, onClose };
}

describe("streaming ASR final boundaries", () => {
  beforeEach(() => { resetAsrQuotaForTest(); vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal("WebSocket", Socket); });
  afterEach(() => { resetAsrQuotaForTest(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("sends the current interaction before each utterance on a trace-aware relay", async () => {
    const opening = openRelayAsrStream({ onPartial: vi.fn() });
    const socket = Socket.instances.at(-1)!;
    socket.onopen?.();
    expect(JSON.parse(String(socket.sent[0]))).toMatchObject({ type: "start", trace_context: true });
    socket.message({ type: "ready", trace_context: true });
    const stream = await opening;
    for (const id of ["a".repeat(32), "b".repeat(32)]) {
      bindInteraction(stream, id);
      const pcm = new ArrayBuffer(1280);
      stream.send(pcm);
      stream.send(pcm);
      expect(socket.sent.slice(-3)).toEqual([
        JSON.stringify({ type: "turn", interaction_id: id }), pcm, pcm,
      ]);
      const final = stream.finishUtterance();
      socket.message({ type: "final", text: "ok" });
      await expect(final).resolves.toBe("ok");
    }
    stream.close();
  });

  it("preserves 11201 before relay readiness as a quota error", async () => {
    const opening = openRelayAsrStream({ onPartial: vi.fn() });
    const socket = Socket.instances.at(-1)!;
    socket.onopen?.();
    socket.message({ type: "error", code: 11201, message: "licc failed" });
    await expect(opening).rejects.toMatchObject({ name: "AsrQuotaError" });
  });

  it("preserves 11201 after relay readiness and before finalize", async () => {
    const { stream, socket } = await ready();
    socket.message({ type: "error", code: 11201, message: "licc failed" });
    await expect(stream.finishUtterance()).rejects.toMatchObject({ name: "AsrQuotaError" });
  });

  it.each([10005, 11200])("preserves relay non-quota provider code %s", async (code) => {
    const { stream, socket } = await ready();
    const final = stream.finishUtterance();
    socket.message({ type: "error", code, message: "provider rejected" });
    await expect(final).rejects.toMatchObject({ name: "AsrProviderError", providerCode: code });
    expect(isAsrQuotaCooling()).toBe(false);
  });

  it("preserves 11201 after relay readiness and rejects the pending final", async () => {
    const { stream, socket } = await ready();
    const final = stream.finishUtterance();
    socket.message({ type: "error", code: 11201, message: "licc failed" });
    await expect(final).rejects.toMatchObject({ name: "AsrQuotaError" });
  });

  it("discards a timed-out connection before audio from the next utterance is sent", async () => {
    const { stream, socket, onClose } = await ready();
    const final = stream.finishUtterance();
    const checked = expect(final).rejects.toThrow("ASR final timed out");
    await vi.advanceTimersByTimeAsync(9_000);
    await checked;
    const before = socket.sent.length;
    stream.send(new ArrayBuffer(1_280));
    expect(socket.sent).toHaveLength(before);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("settles an in-flight utterance immediately when the call is closed", async () => {
    const { stream, socket } = await ready();
    // The transport's close event may arrive much later than a user hangup.
    socket.close = () => { socket.readyState = Socket.CLOSED; };
    const final = stream.finishUtterance();
    stream.close();
    await expect(final).rejects.toThrow("ASR connection closed");
  });

  it("returns the final transcript and keeps a healthy connection available", async () => {
    const { stream, socket } = await ready();
    const final = stream.finishUtterance();
    socket.message({ type: "partial", text: "coffee" });
    socket.message({ type: "final", text: "coffee please" });
    expect(await final).toBe("coffee please");
    expect(socket.readyState).toBe(Socket.OPEN);
    stream.close();
  });

  it("resolves an explicit empty final without treating it as a transport failure", async () => {
    const { stream, socket } = await ready();
    const final = stream.finishUtterance();
    socket.message({ type: "final", text: "" });
    await expect(final).resolves.toBe("");
    expect(socket.readyState).toBe(Socket.OPEN);
    stream.close();
  });

  it("does not start a delayed relay handshake after the identity changes", async () => {
    setToken("relay-a");
    const checked = expect(openRelayAsrStream({ onPartial: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
    const socket = Socket.instances.at(-1)!;
    setToken("relay-b"); setToken("relay-a");
    socket.onopen?.();
    await checked;
    expect(socket.sent).not.toContain(JSON.stringify({ type: "start", language: "en_us" }));
    expect(socket.readyState).toBe(Socket.CLOSED);
  });

  it("does not upload new frames from a stale relay stream", async () => {
    setToken("relay-upload-a");
    const { stream, socket } = await ready();
    setToken("relay-upload-b");
    stream.send(new ArrayBuffer(1280));
    expect(socket.sent.some(value => value instanceof ArrayBuffer)).toBe(false);
    expect(socket.readyState).toBe(Socket.CLOSED);
  });

  it("rejects a tail-only final after the relay fails midway through recording", async () => {
    const { stream, socket, onClose } = await ready();
    stream.send(new ArrayBuffer(1_280));
    socket.message({ type: "error", message: "opening timed out" });
    const final = stream.finishUtterance();
    socket.message({ type: "final", text: "tail only" });
    await expect(final).rejects.toThrow("opening timed out");
    expect(onClose).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(Socket.CLOSED);
  });
});
