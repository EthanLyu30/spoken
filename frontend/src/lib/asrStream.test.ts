import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRelayAsrStream } from "./asrStream";
import { setToken } from "./authToken";

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
  beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal("WebSocket", Socket); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("discards a timed-out connection before audio from the next utterance is sent", async () => {
    const { stream, socket, onClose } = await ready();
    const final = stream.finishUtterance();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(await final).toBe("");
    const before = socket.sent.length;
    stream.send(new ArrayBuffer(1_280));
    expect(socket.sent).toHaveLength(before);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("settles an in-flight utterance immediately when the call is closed", async () => {
    const { stream, socket } = await ready();
    // The transport's close event may arrive much later than a user hangup.
    socket.close = () => { socket.readyState = Socket.CLOSED; };
    const settled = vi.fn();
    void stream.finishUtterance().then(settled);
    stream.close();
    await Promise.resolve();
    expect(settled).toHaveBeenCalledWith("");
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
    expect(await final).toBe("");
    expect(onClose).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(Socket.CLOSED);
  });
});
