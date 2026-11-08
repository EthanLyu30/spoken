import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAsrQuotaForTest } from "./asrQuota";

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
    resetAsrQuotaForTest();
    vi.resetModules(); Socket.instances = [];
    vi.stubGlobal("WebSocket", Socket);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ url: "wss://iat-api.xfyun.cn/v2/iat?authorization=test", app_id: "public-app" }), { status: 200 })));
  });
  afterEach(() => { resetAsrQuotaForTest(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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

  it("classifies provider code 11201 as a quota failure", async () => {
    const { stream, socket } = await ready();
    stream.send(new Uint8Array(1280).fill(1).buffer);
    const final = stream.finishUtterance();
    socket.onmessage?.({ data: JSON.stringify({ code: 11201, message: "licc failed" }) });
    await expect(final).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(socket.readyState).toBe(Socket.CLOSED);
  });

  it("resolves a real empty final without turning it into a transport failure", async () => {
    const { stream, socket } = await ready();
    stream.send(new Uint8Array(1280).fill(1).buffer);
    const final = stream.finishUtterance();
    socket.result({ status: 2 });
    await expect(final).resolves.toBe("");
  });

  it("does not use a delayed successful signature after quota cooling", async () => {
    const quota = await import("./asrQuota");
    const makeSession = () => {
      let resolveSession!: () => void;
      const fetchMock = vi.fn((input: unknown) => {
        if (!String(input).includes("/api/asr/session")) return Promise.resolve(new Response("{}", { status: 202 }));
        return new Promise<Response>(resolve => { resolveSession = () => resolve(new Response(JSON.stringify({ url: "wss://iat-api.xfyun.cn/v2/iat?authorization=test", app_id: "public-app" }))); });
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, resolveSession: () => resolveSession!() };
    };

    const { openAsrStream } = await import("./asrStream");
    const first = makeSession();
    const opening = openAsrStream({ onPartial: vi.fn() });
    await vi.waitFor(() => expect(first.fetchMock).toHaveBeenCalledOnce());
    quota.markAsrQuota();
    first.resolveSession();
    await expect(opening).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(Socket.instances).toHaveLength(0);
    expect(first.fetchMock.mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it("does not upload a whole clip after a delayed successful signature", async () => {
    const quota = await import("./asrQuota");
    let resolveSession!: () => void;
    const fetchMock = vi.fn((input: unknown) => {
      if (!String(input).includes("/api/asr/session")) return Promise.resolve(new Response("{}", { status: 202 }));
      return new Promise<Response>(resolve => { resolveSession = () => resolve(new Response(JSON.stringify({ url: "wss://iat-api.xfyun.cn/v2/iat?authorization=test", app_id: "public-app" }))); });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { postAsr } = await import("./api");
    const whole = postAsr(new ArrayBuffer(1_280));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    quota.markAsrQuota();
    resolveSession();
    await expect(whole).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(Socket.instances).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it("does not fall back after a delayed failed signature when quota cooling starts", async () => {
    const quota = await import("./asrQuota");
    let rejectSession!: (error: Error) => void;
    const fetchMock = vi.fn((input: unknown) => {
      if (!String(input).includes("/api/asr/session")) return Promise.resolve(new Response("{}", { status: 202 }));
      return new Promise<Response>((_resolve, reject) => { rejectSession = reject; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { openAsrStream } = await import("./asrStream");
    const opening = openAsrStream({ onPartial: vi.fn() });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    quota.markAsrQuota();
    rejectSession(new Error("network"));
    await expect(opening).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(Socket.instances).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it("does not upload a whole clip after a delayed failed signature", async () => {
    const quota = await import("./asrQuota");
    let rejectSession!: (error: Error) => void;
    const fetchMock = vi.fn((input: unknown) => {
      if (!String(input).includes("/api/asr/session")) return Promise.resolve(new Response("{}", { status: 202 }));
      return new Promise<Response>((_resolve, reject) => { rejectSession = reject; });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { postAsr } = await import("./api");
    const whole = postAsr(new ArrayBuffer(1_280));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    quota.markAsrQuota();
    rejectSession(new Error("network"));
    await expect(whole).rejects.toMatchObject({ name: "AsrQuotaError" });
    expect(Socket.instances).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([url]) => /\/api\/asr$/.test(String(url)))).toHaveLength(0);
  });

  it("preserves 11201 after the last frame and before finalize", async () => {
    const { transcribeDirect } = await import("./directAsr");
    const closing = transcribeDirect(new ArrayBuffer(1_280));
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0];
    socket.onopen?.();
    await vi.waitFor(() => expect(socket.frames.length).toBeGreaterThan(0));
    socket.onmessage?.({ data: JSON.stringify({ code: 11201, message: "licc failed" }) });
    await expect(closing).rejects.toMatchObject({ name: "AsrQuotaError" });
  });

  it("does not lose 11201 while uploading a whole clip", async () => {
    const { transcribeDirect } = await import("./directAsr");
    const closing = transcribeDirect(new ArrayBuffer(2_560));
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0];
    socket.onopen?.();
    await vi.waitFor(() => expect(socket.frames.length).toBeGreaterThan(0));
    socket.onmessage?.({ data: JSON.stringify({ code: 11201, message: "licc failed" }) });
    await expect(closing).rejects.toMatchObject({ name: "AsrQuotaError" });
  });

  it("closes an in-flight recording immediately when cancelled", async () => {
    const controller = new AbortController();
    const { stream, socket, onClose } = await ready(controller.signal);
    stream.send(new ArrayBuffer(1280));
    const final = stream.finishUtterance(); controller.abort();
    await expect(final).rejects.toMatchObject({ name: "AbortError" });
    expect(socket.readyState).toBe(Socket.CLOSED);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects untrusted authorization destinations before opening a socket", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ url: "wss://unrelated.example/socket", app_id: "public-app" })));
    const { openDirectAsrStream } = await import("./directAsr");
    await expect(openDirectAsrStream({ onPartial: vi.fn() })).rejects.toThrow();
    expect(Socket.instances).toHaveLength(0);
  });

  it.each(["fetch", "json"])("does not open a provider socket after identity changes during authorization %s", async stage => {
    const { setToken } = await import("./authToken");
    setToken("direct-a");
    let finish!: (value: unknown) => void;
    const waiting = new Promise(resolve => { finish = resolve; });
    vi.mocked(fetch).mockImplementation(() => stage === "fetch"
      ? waiting as Promise<Response>
      : Promise.resolve({ ok: true, json: () => waiting } as Response));
    const { openDirectAsrStream } = await import("./directAsr");
    const checked = expect(openDirectAsrStream({ onPartial: vi.fn() })).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    setToken("direct-b"); setToken("direct-a");
    const session = { url: "wss://iat-api.xfyun.cn/v2/iat?authorization=test", app_id: "public-app" };
    finish(stage === "fetch" ? new Response(JSON.stringify(session)) : session);
    await checked;
    expect(Socket.instances).toHaveLength(0);
    // Identity cancellation must not put the next owner's transport in cooldown.
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(session)));
    const fresh = await ready();
    fresh.stream.close();
  });

  it("does not send retained audio after an identity change before the first upload", async () => {
    const { setToken } = await import("./authToken");
    setToken("direct-upload-a");
    const { stream, socket } = await ready();
    setToken("direct-upload-b");
    stream.send(new ArrayBuffer(1280));
    expect(socket.frames).toHaveLength(0);
    expect(socket.readyState).toBe(Socket.CLOSED);
  });

  it("does not accept a tail-only transcript after a provider error", async () => {
    const { stream, socket } = await ready();
    stream.send(new ArrayBuffer(1280));
    socket.onmessage?.({ data: JSON.stringify({ code: 10005, message: "rejected" }) });
    const final = stream.finishUtterance();
    socket.result({ status: 2, result: { sn: 0, ws: [{ cw: [{ w: "tail only" }] }] } });
    await expect(final).rejects.toThrow("ASR provider error");
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
    const checked = expect(final).rejects.toThrow("ASR final timed out");
    await vi.advanceTimersByTimeAsync(5_100);
    await checked;
    const { openDirectAsrStream } = await import("./directAsr");
    await expect(openDirectAsrStream({ onPartial: vi.fn() })).rejects.toThrow();
    expect(Socket.instances).toHaveLength(1);
  });
});
