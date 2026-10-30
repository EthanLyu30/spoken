import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTtsUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
  createObjectUrl: vi.fn(),
  synthesizeWithKokoro: vi.fn(),
  localReady: false,
}));

vi.mock("./api", () => ({
  fetchTtsUrl: mocks.fetchTtsUrl,
}));

vi.mock("../store/voice", () => ({
  useVoice: {
    getState: () => ({
      engine: "browser",
      vcn: null,
      browserVoiceURI: null,
      speed: null,
      pitch: null,
    }),
  },
}));

vi.mock("./voiceResolver", () => ({
  resolveVoiceMode: () =>
    Promise.resolve({
      kind: "iflytek",
      automaticFallback: true,
    }),
  autoCloudOverrides: () => ({
    vcn: "x4_lindsey_formal",
    speed: 58,
    pitch: 52,
  }),
}));

vi.mock("./localSpeech/runtime", () => ({
  isLocalSpeechModelReady: () => mocks.localReady,
}));

vi.mock("./localSpeech/kokoro", () => ({
  synthesizeWithKokoro: mocks.synthesizeWithKokoro,
}));

import { createSpeechQueue, speakText, stopSpeaking } from "./speech";

const audioInstances: FakeAudio[] = [];

class FakeAudio {
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly src: string) {
    audioInstances.push(this);
  }

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {}
}

describe("cloud speech queue cleanup", () => {
  it("marks buffered playback errors after start without changing the resolved playback contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    mocks.fetchTtsUrl.mockResolvedValue("blob:qa-audio");
    const queue = createSpeechQueue("cafe");
    const finished = queue.end("Hello there.");
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    audioInstances[0].onplaying?.();
    audioInstances[0].onerror?.();
    await finished;
    const event = fetcher.mock.calls.map(([, options]) => JSON.parse(options.body)).find(item => item.operation === "speech.complete");
    expect(event.outcome).toBe("error");
  });
  beforeEach(() => {
    mocks.fetchTtsUrl.mockReset();
    mocks.revokeObjectUrl.mockReset();
    mocks.createObjectUrl.mockReset();
    mocks.synthesizeWithKokoro.mockReset();
    mocks.localReady = false;
    audioInstances.length = 0;
    vi.stubGlobal("Audio", FakeAudio);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: mocks.createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectUrl,
    });
  });

  afterEach(() => {
    stopSpeaking();
    vi.unstubAllGlobals();
  });

  it("uses ready Kokoro for automatic fallback instead of calling iFlytek", async () => {
    mocks.localReady = true;
    mocks.createObjectUrl.mockReturnValue("blob:kokoro");
    mocks.synthesizeWithKokoro.mockResolvedValue({
      audio: new Float32Array([0, 0.25, -0.25]),
      sampleRate: 24_000,
    });

    const speaking = speakText("Hello from Kokoro");
    await vi.waitFor(() => {
      expect(mocks.synthesizeWithKokoro).toHaveBeenCalledWith(
        "Hello from Kokoro",
        expect.any(Number),
      );
      expect(audioInstances).toHaveLength(1);
    });

    expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
    expect(audioInstances[0].src).toBe("blob:kokoro");
    audioInstances[0].onended?.();
    await speaking.done;
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:kokoro");
  });

  it("recovers with iFlytek when Kokoro synthesis fails", async () => {
    mocks.localReady = true;
    mocks.synthesizeWithKokoro.mockRejectedValue(new Error("wasm failed"));
    mocks.fetchTtsUrl.mockResolvedValue("blob:cloud");

    const speaking = speakText("Fallback sentence");
    await vi.waitFor(() => {
      expect(mocks.fetchTtsUrl).toHaveBeenCalledOnce();
      expect(audioInstances).toHaveLength(1);
    });

    expect(audioInstances[0].src).toBe("blob:cloud");
    audioInstances[0].onended?.();
    await speaking.done;
  });

  it("does not start a cloud request after stopped Kokoro synthesis fails", async () => {
    mocks.localReady = true;
    let rejectLocal: (reason: Error) => void = () => undefined;
    mocks.synthesizeWithKokoro.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectLocal = reject;
        }),
    );
    mocks.fetchTtsUrl.mockResolvedValue("blob:should-not-start");

    const speaking = speakText("Cancelled sentence");
    await vi.waitFor(() =>
      expect(mocks.synthesizeWithKokoro).toHaveBeenCalledOnce(),
    );
    speaking.stop();
    rejectLocal(new Error("worker stopped"));
    await speaking.done;

    expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  });

  it("switches a streaming reply to Kokoro at the next sentence boundary", async () => {
    mocks.fetchTtsUrl
      .mockResolvedValueOnce("blob:first-cloud")
      .mockResolvedValueOnce("blob:second-prefetch");
    mocks.createObjectUrl.mockReturnValue("blob:second-kokoro");
    mocks.synthesizeWithKokoro.mockResolvedValue({
      audio: new Float32Array([0, 0.1]),
      sampleRate: 24_000,
    });

    const queue = createSpeechQueue("cafe");
    queue.feed("First. Second. ");
    const done = queue.end("First. Second. ");
    await vi.waitFor(() => {
      expect(audioInstances).toHaveLength(1);
      expect(mocks.fetchTtsUrl).toHaveBeenCalledTimes(2);
    });

    mocks.localReady = true;
    audioInstances[0].onended?.();
    await vi.waitFor(() => {
      expect(mocks.synthesizeWithKokoro).toHaveBeenCalledWith(
        "Second.",
        expect.any(Number),
      );
      expect(audioInstances).toHaveLength(2);
    });
    expect(audioInstances[1].src).toBe("blob:second-kokoro");
    audioInstances[1].onended?.();
    await done;

    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith(
      "blob:second-prefetch",
    );
  });

  it("revokes prefetched audio when the queue is stopped before playback", async () => {
    let resolvePrefetch: (url: string) => void = () => undefined;
    mocks.fetchTtsUrl
      .mockResolvedValueOnce("blob:first")
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolvePrefetch = resolve;
          }),
      );

    const queue = createSpeechQueue("cafe");
    queue.feed("First. Second. ");

    await vi.waitFor(() => {
      expect(mocks.fetchTtsUrl).toHaveBeenCalledTimes(2);
    });

    queue.stop();
    resolvePrefetch("blob:second");
    await queue.end("First. Second. ");
    await Promise.resolve();

    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:first");
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:second");
  });

  it("synthesizes the next local sentence while the current sentence is playing", async () => {
    mocks.localReady = true;
    mocks.createObjectUrl.mockReturnValueOnce("blob:local-first").mockReturnValueOnce("blob:local-next");
    mocks.synthesizeWithKokoro.mockResolvedValue({ audio: new Float32Array([0, 0.1]), sampleRate: 24000 });
    const queue = createSpeechQueue("cafe");
    queue.feed("First. Second. ");
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    try {
      await vi.waitFor(() => expect(mocks.synthesizeWithKokoro).toHaveBeenCalledTimes(2));
      expect(audioInstances).toHaveLength(1);
    } finally { queue.stop(); await queue.end("First. Second. "); }
  });

  it("global stop also stops the active streaming speech queue", async () => {
    mocks.fetchTtsUrl.mockResolvedValue("blob:active-queue");
    const queue = createSpeechQueue("cafe");
    queue.feed("First. ");
    await vi.waitFor(() => expect(audioInstances).toHaveLength(1));
    stopSpeaking();
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:active-queue");
    queue.stop();
    await queue.end("First. ");
  });

  it("recovers a failed local prefetch with cloud audio instead of skipping the sentence", async () => {
    mocks.localReady = true;
    mocks.createObjectUrl.mockReturnValue("blob:local-first");
    mocks.synthesizeWithKokoro.mockResolvedValueOnce({ audio: new Float32Array([0, 0.1]), sampleRate: 24000 }).mockRejectedValueOnce(new Error("worker failed"));
    mocks.fetchTtsUrl.mockResolvedValue("blob:cloud-second");
    const queue = createSpeechQueue("cafe");
    queue.feed("First. Second. ");
    const done = queue.end("First. Second. ");
    try {
      await vi.waitFor(() => expect(mocks.synthesizeWithKokoro).toHaveBeenCalledTimes(2));
      audioInstances[0].onended?.();
      await vi.waitFor(() => expect(mocks.fetchTtsUrl).toHaveBeenCalledOnce());
      expect(audioInstances[1].src).toBe("blob:cloud-second");
      audioInstances[1].onended?.();
      await done;
    } finally { queue.stop(); }
  });
});
