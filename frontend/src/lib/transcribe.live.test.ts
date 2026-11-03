import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openAsrStream: vi.fn(),
  postAsr: vi.fn(),
}));

vi.mock("./api", () => ({ postAsr: mocks.postAsr }));
vi.mock("./asrStream", () => ({ openAsrStream: mocks.openAsrStream }));

import { createLiveTranscription } from "./transcribe";

describe("live ASR recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces a partial live transcript with the complete recording after a relay close", async () => {
    const stream = {
      send: vi.fn(),
      finishUtterance: vi.fn(async () => {
        throw new Error("ASR connection closed");
      }),
      close: vi.fn(),
    };
    mocks.openAsrStream.mockResolvedValue(stream);
    mocks.postAsr.mockResolvedValue("  complete transcript  ");

    const live = createLiveTranscription();
    const callbacks = mocks.openAsrStream.mock.calls[0][0] as {
      onPartial: (text: string) => void;
    };
    callbacks.onPartial("half a transcript");
    const pcm = new ArrayBuffer(1280);
    live.send(pcm);

    await expect(live.finish(pcm)).resolves.toBe("complete transcript");
    expect(mocks.postAsr).toHaveBeenCalledWith(pcm, undefined);
  });

  it("keeps the partial when the complete-recording recovery also fails", async () => {
    const stream = {
      send: vi.fn(),
      finishUtterance: vi.fn(async () => {
        throw new Error("ASR connection closed");
      }),
      close: vi.fn(),
    };
    mocks.openAsrStream.mockResolvedValue(stream);
    mocks.postAsr.mockRejectedValue(new Error("network unavailable"));

    const live = createLiveTranscription();
    const callbacks = mocks.openAsrStream.mock.calls[0][0] as {
      onPartial: (text: string) => void;
    };
    callbacks.onPartial("half a transcript");

    await expect(live.finish(new ArrayBuffer(1280))).resolves.toBe("half a transcript");
  });
});
