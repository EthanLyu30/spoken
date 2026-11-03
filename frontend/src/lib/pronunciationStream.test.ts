import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPronunciationStream } from "./pronunciationStream";
import { setToken } from "./authToken";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "";
  sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: {
    data: string;
  }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { Socket.instances.push(this); }
  send(value: string | ArrayBuffer) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const result = { overall: 91, accuracy: 92, fluency: 93, integrity: 94, standard: 95, words: [] };
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal("WebSocket", Socket); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function start() { const onError = vi.fn(), stream = createPronunciationStream("Read this", undefined, onError), socket = Socket.instances[0]; expect(socket).toBeDefined(); socket.open(); return { stream, socket, onError }; }
it("uploads queued and new PCM before finish, with the agreed protocol and bounded frames", async () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://speech.example.test");
  const { stream, socket } = start();
  stream.send(new ArrayBuffer(70000));
  socket.message({ type: "ready" });
  stream.send(new ArrayBuffer(1280));
  expect(socket.url).toBe("wss://speech.example.test/api/pronunciation/stream");
  expect(JSON.parse(socket.sent[0] as string)).toEqual({ type: "start", text: "Read this", language: "en", entry: "follow_read" });
  expect(socket.sent.filter(value => value instanceof ArrayBuffer).map(value => value.byteLength)).toEqual([65536, 4464, 1280]);
  const finished = stream.finish();
  expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: "end" });
  socket.message({ type: "result", result });
  await expect(finished).resolves.toEqual(result);
  expect(socket.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds startup waiting and returns buffered fallback only when ready never arrived", async () => {
  const { stream, socket, onError } = start();
  stream.send(new ArrayBuffer(1280));
  const finished = stream.finish();
  await vi.advanceTimersByTimeAsync(12000);
  await expect(finished).resolves.toBeNull();
  expect(socket.readyState).toBe(3);
  expect(onError).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("retains a short recording's queued audio and end until provider readiness", async () => {
  const { stream, socket } = start();
  stream.send(new ArrayBuffer(1280));
  const finished = stream.finish();
  expect(socket.sent).toHaveLength(1);
  socket.message({ type: "ready" });
  expect(socket.sent[1]).toBeInstanceOf(ArrayBuffer);
  expect(socket.sent[2]).toBe('{"type":"end"}');
  socket.message({ type: "result", result });
  await expect(finished).resolves.toEqual(result);
});
it.each(["network", "provider"])("never returns fallback after ready on %s failure", async (failure) => {
  const { stream, socket, onError } = start();
  socket.message({ type: "ready" });
  stream.send(new ArrayBuffer(1280));
  if (failure === "network")
    socket.onerror?.();
  else
    socket.message({ type: "error", message: "provider failed" });
  expect(onError).toHaveBeenCalledTimes(1);
  await expect(stream.finish()).rejects.toThrow();
  expect(socket.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("times out a silent final result without an early unhandled rejection", async () => {
  const { stream, socket, onError } = start();
  socket.message({ type: "ready" });
  stream.send(new ArrayBuffer(1280));
  const checked = expect(stream.finish()).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(20000);
  await checked;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});
it("bounds total duration even if the caller never stops", async () => {
  const { stream, socket, onError } = start();
  socket.message({ type: "ready" });
  await vi.advanceTimersByTimeAsync(210000);
  expect(onError).toHaveBeenCalledTimes(1);
  await expect(stream.finish()).rejects.toThrow(/timed out/);
  expect(socket.readyState).toBe(3);
});
it.each(["abort", "identity"])("closes and rejects on %s while ignoring late messages", async (cancellation) => {
  setToken("stream-before");
  const controller = new AbortController(), stream = createPronunciationStream("Read", controller.signal), socket = Socket.instances[0];
  socket.open();
  socket.message({ type: "ready" });
  stream.send(new ArrayBuffer(1280));
  const checked = expect(stream.finish()).rejects.toMatchObject({ name: "AbortError" });
  if (cancellation === "abort")
    controller.abort();
  else
    setToken("stream-after");
  socket.message({ type: "result", result });
  await checked;
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.readyState).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});
it("falls back when startup queue reaches its bound without unbounded buffering", async () => {
  const { stream, socket } = start();
  for (let i = 0;i < 7;i++)
    stream.send(new ArrayBuffer(65536));
  await expect(stream.finish()).resolves.toBeNull();
  expect(socket.readyState).toBe(3);
});
it("fails visibly after ready when socket backpressure exceeds its bound", async () => {
  const { stream, socket, onError } = start();
  socket.message({ type: "ready" });
  socket.bufferedAmount = 400000;
  stream.send(new ArrayBuffer(1280));
  await expect(stream.finish()).rejects.toThrow();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});
it("rejects oversized audio and releases the connection", async () => {
  const { stream, socket, onError } = start();
  socket.message({ type: "ready" });
  for (let i = 0;i < 89;i++)
    stream.send(new ArrayBuffer(65536));
  await expect(stream.finish()).rejects.toThrow(/180/);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});
it("allows paced startup backlog to drain before timing out the final result", async () => {
  const { stream, socket, onError } = start();
  stream.send(new ArrayBuffer(320000));
  await vi.advanceTimersByTimeAsync(10000);
  socket.message({ type: "ready" });
  const finished = stream.finish().then(value => ({ value }), error => ({ error }));
  await vi.advanceTimersByTimeAsync(25000);
  socket.message({ type: "result", result });
  expect(await finished).toEqual({ value: result });
  expect(onError).not.toHaveBeenCalled();
});
it("still bounds the final deadline after allowing ten seconds of startup audio backlog", async () => {
  const { stream, socket, onError } = start();
  stream.send(new ArrayBuffer(320000));
  await vi.advanceTimersByTimeAsync(10000);
  socket.message({ type: "ready" });
  const checked = expect(stream.finish()).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(29000);
  expect(onError).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1001);
  await checked;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(socket.readyState).toBe(3);
});

it("accepts 2000 Unicode reference points even when an emoji needs two UTF16 units", async () => {
  const reference="a".repeat(1999)+"😊";
  const stream=createPronunciationStream(reference),socket=Socket.instances[0];
  expect(socket).toBeDefined();socket.open();
  expect(JSON.parse(socket.sent[0] as string).text).toBe(reference);
  socket.message({type:"ready"});stream.send(new ArrayBuffer(1280));
  const finished=stream.finish();socket.message({type:"result",result});
  await expect(finished).resolves.toEqual(result);
});

it("rejects 2001 Unicode reference points before opening a provider connection", async () => {
  const onError=vi.fn();
  const stream=createPronunciationStream("a".repeat(1999)+"😊"+"z",undefined,onError);
  expect(Socket.instances).toHaveLength(0);expect(onError).toHaveBeenCalledTimes(1);
  await expect(stream.finish()).rejects.toThrow(/1–2000/);
});
