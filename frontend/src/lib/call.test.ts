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
      ),
    );
    expect(mocks.openAsrStream).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(reply).toHaveBeenCalledWith(
        "hello locally",
        expect.any(ArrayBuffer),
        expect.any(Function),
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
      ),
    );
    call.end();
  });
});
