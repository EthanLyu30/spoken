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
    expect(mocks.postAsr).toHaveBeenCalledWith(pcm, undefined, expect.any(Function));
  });

  it("requires confirmation of a partial when complete-recording recovery also fails", async () => {
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

    await expect(live.finish(new ArrayBuffer(1280))).rejects.toMatchObject({
      name: "IncompleteTranscriptionError", partialText: "half a transcript",
    });
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it("does not promote a partial to a final when the stream returns an empty final", async () => {
    mocks.openAsrStream.mockResolvedValue({ send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockResolvedValue("") });
    mocks.postAsr.mockResolvedValue("");
    const live = createLiveTranscription();
    mocks.openAsrStream.mock.calls[0][0].onPartial("only the beginning");
    await expect(live.finish(new ArrayBuffer(1280))).rejects.toMatchObject({
      name: "IncompleteTranscriptionError", partialText: "only the beginning",
    });
    expect(mocks.postAsr).toHaveBeenCalledOnce();
  });

  it("uses the confirmed final instead of an older partial without replaying the recording", async () => {
    mocks.openAsrStream.mockResolvedValue({ send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockResolvedValue("I would like a coffee.") });
    const live = createLiveTranscription();
    mocks.openAsrStream.mock.calls[0][0].onPartial("I would");
    await expect(live.finish(new ArrayBuffer(1280))).resolves.toBe("I would like a coffee.");
    expect(mocks.postAsr).not.toHaveBeenCalled();
  });

  it("never exposes a partial or starts recovery after cancellation", async () => {
    const controller = new AbortController();
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockRejectedValue(new Error("closed")) };
    mocks.openAsrStream.mockResolvedValue(stream);
    const live = createLiveTranscription(controller.signal);
    mocks.openAsrStream.mock.calls[0][0].onPartial("private incomplete answer");
    controller.abort();
    await expect(live.finish(new ArrayBuffer(1280))).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.postAsr).not.toHaveBeenCalled();
    live.close();
  });
});
