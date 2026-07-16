import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTtsUrl: vi.fn(),
  revokeObjectUrl: vi.fn(),
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

import { createSpeechQueue } from "./speech";

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly src: string) {}

  play(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {}
}

describe("cloud speech queue cleanup", () => {
  beforeEach(() => {
    mocks.fetchTtsUrl.mockReset();
    mocks.revokeObjectUrl.mockReset();
    vi.stubGlobal("Audio", FakeAudio);
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: mocks.revokeObjectUrl,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
