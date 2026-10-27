import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openAsrStream: vi.fn(),
}));

vi.mock("./asrStream", () => ({
  openAsrStream: mocks.openAsrStream,
}));

import { startVoiceCall } from "./call";

interface FakeProcessor {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
  connect: () => void;
  disconnect: () => void;
}

let latestProcessor: FakeProcessor | null = null;

class FakeAudioContext {
  sampleRate = 16_000;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;

  constructor(_options?: AudioContextOptions) {}

  async resume(): Promise<void> {}
  async close(): Promise<void> {}

  createMediaStreamSource() {
    return { connect: () => undefined, disconnect: () => undefined };
  }

  createScriptProcessor(): FakeProcessor {
    latestProcessor = {
      onaudioprocess: null,
      connect: () => undefined,
      disconnect: () => undefined,
    };
    return latestProcessor;
  }

  createGain() {
    return {
      gain: { value: 1 },
      connect: () => undefined,
      disconnect: () => undefined,
    };
  }
}

function pushFrame(value: number): void {
  const processor = latestProcessor;
  if (!processor?.onaudioprocess) throw new Error("audio graph not ready");
  const samples = new Float32Array(4_096).fill(value);
  processor.onaudioprocess({
    inputBuffer: {
      getChannelData: () => samples,
    },
  } as unknown as AudioProcessingEvent);
}

describe("voice call ASR engine boundaries", () => {
  beforeEach(() => {
    mocks.openAsrStream.mockReset();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const track = { onended: null, stop: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })),
    } });
  });

  afterEach(() => {
    latestProcessor = null;
    vi.unstubAllGlobals();
  });

  it("keeps a locally-selected utterance off the iFlytek stream", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const track = { onended: null, stop: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [track],
          getTracks: () => [track],
        })),
      },
    });
    const transcribe = vi.fn(async () => "hello locally");
    const reply = vi.fn(async () => undefined);

    const call = await startVoiceCall({
      onPhase: vi.fn(),
      preferLocalAsr: () => true,
      transcribe,
      reply,
      onError: vi.fn(),
    });

    pushFrame(0.1);
    pushFrame(0.1);
    pushFrame(0);
    pushFrame(0);
    pushFrame(0);
    pushFrame(0);

    await vi.waitFor(() =>
      expect(transcribe).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "local",
        expect.any(AbortSignal),
      ),
    );
    expect(mocks.openAsrStream).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledWith(
        "hello locally",
        expect.any(ArrayBuffer),
        expect.any(Function),
        expect.any(AbortSignal),
      ),
    );
    call.end();
  });

  it("closes a cloud stream that finishes opening after a local turn starts", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const track = { onended: null, stop: vi.fn() };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [track],
          getTracks: () => [track],
        })),
      },
    });
    const opened = {
      send: vi.fn(),
      finishUtterance: vi.fn(async () => "cloud"),
      close: vi.fn(),
    };
    let resolveOpen: (stream: typeof opened) => void = () => undefined;
    mocks.openAsrStream.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    );
    let localReady = false;
    const transcribe = vi.fn(async () => "local text");
    const call = await startVoiceCall({
      onPhase: vi.fn(),
      preferLocalAsr: () => localReady,
      transcribe,
      reply: vi.fn(async () => undefined),
      onError: vi.fn(),
    });
    expect(mocks.openAsrStream).toHaveBeenCalledOnce();

    localReady = true;
    pushFrame(0.1);
    pushFrame(0.1);
    pushFrame(0);
    pushFrame(0);
    pushFrame(0);
    pushFrame(0);
    resolveOpen(opened);

    await vi.waitFor(() => expect(opened.close).toHaveBeenCalledOnce());
    expect(opened.send).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(transcribe).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        "local",
        expect.any(AbortSignal),
      ),
    );
    call.end();
  });

  it("transcribes the short utterance that interrupts Pip, including its first frame", async () => {
    let finishFirst: () => void = () => {};
    const transcribe = vi.fn(async (_pcm: ArrayBuffer, _engine: string, _signal: AbortSignal) => "user turn");
    const reply = vi.fn(async (_text, _pcm, onSpeaking) => {
      onSpeaking();
      if (reply.mock.calls.length === 1) await new Promise<void>((resolve) => { finishFirst = resolve; });
    });
    const interrupt = vi.fn();
    const call = await startVoiceCall({ onPhase: vi.fn(), preferLocalAsr: () => true, transcribe, reply, interrupt, onError: vi.fn() });
    try {
      pushFrame(0.1); pushFrame(0.1);
      for (let i = 0; i < 4; i++) pushFrame(0);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
      pushFrame(0.2); pushFrame(0.2); pushFrame(0.2);
      expect(interrupt).toHaveBeenCalledOnce();
      for (let i = 0; i < 4; i++) pushFrame(0);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      const pcm = transcribe.mock.calls[1][0] as ArrayBuffer;
      expect(new DataView(pcm).getInt16(0, true)).toBeGreaterThan(5000);
    } finally { call.end(); finishFirst(); }
  });

  it("does not let the interrupted turn reopen the mic during the next transcription", async () => {
    let finishFirst: () => void = () => {};
    let finishSecond: (text: string) => void = () => {};
    const onPhase = vi.fn();
    const transcribe = vi.fn().mockResolvedValueOnce("first").mockImplementationOnce(() => new Promise<string>((resolve) => { finishSecond = resolve; }));
    const reply = vi.fn(async (_text, _pcm, onSpeaking) => {
      onSpeaking();
      await new Promise<void>((resolve) => { finishFirst = resolve; });
    });
    const call = await startVoiceCall({ onPhase, preferLocalAsr: () => true, transcribe, reply, interrupt: vi.fn(), onError: vi.fn() });
    try {
      pushFrame(0.1); pushFrame(0.1);
      for (let i = 0; i < 4; i++) pushFrame(0);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
      for (let i = 0; i < 5; i++) pushFrame(0.2);
      for (let i = 0; i < 4; i++) pushFrame(0);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      finishFirst();
      for (let i = 0; i < 6; i++) await Promise.resolve();
      expect(onPhase.mock.calls.at(-1)?.[0]).toBe("thinking");
    } finally { call.end(); finishFirst(); finishSecond(""); }
  });

  it("releases a microphone which finishes reconnecting after hangup", async () => {
    const first = { onended: null as (() => void) | null, stop: vi.fn() };
    const late = { onended: null, stop: vi.fn() };
    let complete: (stream: unknown) => void = () => {};
    const getUserMedia = vi.fn().mockResolvedValueOnce({ getAudioTracks: () => [first], getTracks: () => [first] }).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const call = await startVoiceCall({ onPhase: vi.fn(), preferLocalAsr: () => true, transcribe: vi.fn(), reply: vi.fn(), onError: vi.fn() });
    first.onended?.();
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    call.end();
    complete({ getAudioTracks: () => [late], getTracks: () => [late] });
    await vi.waitFor(() => expect(late.stop).toHaveBeenCalledOnce());
  });

  it("falls back to the whole recording when the cloud relay closes midway through speech", async () => {
    const opened = { send: vi.fn(), finishUtterance: vi.fn(async () => "tail only"), close: vi.fn() };
    mocks.openAsrStream.mockResolvedValue(opened);
    const transcribe = vi.fn(async (_pcm: ArrayBuffer) => "complete user turn");
    const reply = vi.fn(async () => undefined);
    const call = await startVoiceCall({ onPhase: vi.fn(), preferLocalAsr: () => false, transcribe, reply, onError: vi.fn() });
    try {
      await Promise.resolve();
      pushFrame(0.1); pushFrame(0.1);
      mocks.openAsrStream.mock.calls[0][0].onClose();
      pushFrame(0.2); pushFrame(0.2);
      for (let i = 0; i < 4; i++) pushFrame(0);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      expect(opened.finishUtterance).not.toHaveBeenCalled();
      const pcm = transcribe.mock.calls[0][0];
      expect(new DataView(pcm).getInt16(0, true)).toBe(3276);
      await vi.waitFor(() => expect(reply).toHaveBeenCalledWith("complete user turn", expect.any(ArrayBuffer), expect.any(Function), expect.any(AbortSignal)));
    } finally { call.end(); }
  });
});
