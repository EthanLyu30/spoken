import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Socket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = Socket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  frames: Record<string, unknown>[] = [];
  constructor(_url: string) { Socket.instances.push(this); }
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  close() { this.readyState = Socket.CLOSED; this.onclose?.(); }
  result(data: unknown) { this.onmessage?.({ data: JSON.stringify({ code: 0, data }) }); }
}

describe("direct cloud ASR transport", () => {
  beforeEach(() => {
    vi.resetModules(); Socket.instances = [];
    vi.stubGlobal("WebSocket", Socket);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "wss://iat-api.xfyun.cn/v2/iat?authorization=test", app_id: "public-app" }), { status: 200 })));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function ready(signal?: AbortSignal, language = "en_us") {
    const { openDirectAsrStream } = await import("./directAsr");
    const onClose = vi.fn(); const onPartial = vi.fn();
    const count = Socket.instances.length;
    const opening = openDirectAsrStream({ onClose, onPartial }, language, signal);
    void opening.catch(() => undefined);
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(count + 1));
    const socket = Socket.instances.at(-1)!; socket.onopen?.();
    return { stream: await opening, socket, onClose, onPartial };
  }

  it("sends a short recording with one terminal marker and retains text on an empty final", async () => {
    const { stream, socket } = await ready();
    stream.send(new Uint8Array(640).fill(1).buffer);
    const final = stream.finishUtterance();
    const frames = socket.frames as { data: { status: number; audio: string }; business?: { language: string; dwa?: string } }[];
    expect(frames[0].data.status).toBe(0);
    expect(frames[0].business?.language).toBe("en_us");
    expect(frames[0].business?.dwa).toBeUndefined();
    expect(atob(frames[0].data.audio)).toHaveLength(640);
    expect(frames.filter(f => f.data.status === 2)).toHaveLength(1);
    socket.result({ status: 1, result: { sn: 1, ws: [{ cw: [{ w: "coffee please" }] }] } });
    socket.result({ status: 2 });
    expect(await final).toBe("coffee please");
    expect(socket.readyState).toBe(Socket.CLOSED);
  });

  it("closes an in-flight recording immediately when cancelled", async () => {
    const controller = new AbortController();
    const { stream, socket, onClose } = await ready(controller.signal);
    stream.send(new ArrayBuffer(1280));
    const final = stream.finishUtterance(); controller.abort();
    expect(await final).toBe("");
    expect(socket.readyState).toBe(Socket.CLOSED);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects untrusted authorization destinations before opening a socket", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ url: "wss://unrelated.example/socket", app_id: "public-app" })));
    const { openDirectAsrStream } = await import("./directAsr");
    await expect(openDirectAsrStream({ onPartial: vi.fn() })).rejects.toThrow();
    expect(Socket.instances).toHaveLength(0);
  });

  it("does not accept a tail-only transcript after a provider error", async () => {
    const { stream, socket } = await ready();
    stream.send(new ArrayBuffer(1280));
    socket.onmessage?.({ data: JSON.stringify({ code: 10005, message: "rejected" }) });
    const final = stream.finishUtterance();
    socket.result({ status: 2, result: { sn: 0, ws: [{ cw: [{ w: "tail only" }] }] } });
    expect(await final).toBe("");
  });

  it("keeps direct recognition available when an unused connection expires", async () => {
    const first = await ready();
    first.socket.onclose?.();
    const second = await ready();
    expect(Socket.instances).toHaveLength(2);
    second.stream.close();
  });

  it("orders provider segments and applies a Chinese replacement before the final", async () => {
    const { stream, socket } = await ready(undefined, "zh_cn");
    stream.send(new ArrayBuffer(1280));
    const final = stream.finishUtterance();
    socket.result({ status: 1, result: { sn: 2, ws: [{ cw: [{ w: "world" }] }] } });
    socket.result({ status: 1, result: { sn: 1, ws: [{ cw: [{ w: "hello " }] }] } });
    socket.result({ status: 2, result: { sn: 3, pgs: "rpl", rg: [1,2], ws: [{ cw: [{ w: "coffee please" }] }] } });
    expect(await final).toBe("coffee please");
  });

  it("discards an unfinalized draft on timeout and skips a repeated failed connection", async () => {
    const { stream, socket } = await ready();
    vi.useFakeTimers();
    stream.send(new ArrayBuffer(1280));
    socket.result({ status: 1, result: { sn: 0, ws: [{ cw: [{ w: "unfinished" }] }] } });
    const final = stream.finishUtterance();
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await final).toBe("");
    const { openDirectAsrStream } = await import("./directAsr");
    await expect(openDirectAsrStream({ onPartial: vi.fn() })).rejects.toThrow();
    expect(Socket.instances).toHaveLength(1);
  });
});
