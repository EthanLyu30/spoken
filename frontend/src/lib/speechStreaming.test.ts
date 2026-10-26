import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchTtsStream: vi.fn(), fetchTtsUrl: vi.fn() }));
vi.mock("./api", () => ({ fetchTtsStream: mocks.fetchTtsStream, fetchTtsUrl: mocks.fetchTtsUrl }));
vi.mock("../store/voice", () => ({ useVoice: { getState: () => ({ engine: "iflytek", vcn: null, speed: null, pitch: null }) } }));
import { createSpeechQueue, speakText, stopSpeaking } from "./speech";

const sources: Array<{ onended: (() => void) | null; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
const close = vi.fn(async () => {});
class Context {
  currentTime = 0;
  destination = {};
  async resume() {}
  close = close;
  createBuffer(_channels: number, count: number, sampleRate: number) { return { duration: count / sampleRate, getChannelData: () => new Float32Array(count) }; }
  createBufferSource() {
    const source = { buffer: null, onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn() };
    sources.push(source);
    return source;
  }
}
beforeEach(() => {
  sources.length = 0;
  mocks.fetchTtsStream.mockReset();
  mocks.fetchTtsUrl.mockReset();
  close.mockClear();
  vi.stubGlobal("AudioContext", Context);
});
afterEach(() => { stopSpeaking(); vi.unstubAllGlobals(); });

it("starts cloud audio before the streamed response finishes and cancels the reader on stop", async () => {
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  mocks.fetchTtsStream.mockResolvedValue(new Response(new ReadableStream({ start(controller) { streamController = controller; }, cancel: cancelled })));
  const speaking = speakText("Hello there");
  await vi.waitFor(() => expect(mocks.fetchTtsStream).toHaveBeenCalledOnce());
  streamController!.enqueue(new Uint8Array([0, 64, 0, 64]));
  await vi.waitFor(() => expect(sources).toHaveLength(1));
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  speaking.stop();
  await speaking.done;
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalled());
  expect(close).toHaveBeenCalledOnce();
});

it("cancels an outstanding cloud synthesis when the queue is stopped", async () => {
  let signal: AbortSignal | undefined;
  mocks.fetchTtsStream.mockImplementation((_text, _id, abortSignal) => {
    signal = abortSignal;
    return new Promise<Response>(() => {});
  });
  const queue = createSpeechQueue("cafe");
  queue.feed("Hello there. ");
  await vi.waitFor(() => expect(mocks.fetchTtsStream).toHaveBeenCalledOnce());
  queue.stop();
  await queue.end("Hello there. ");
  expect(signal?.aborted).toBe(true);
});
