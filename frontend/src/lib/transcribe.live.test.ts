import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openAsrStream: vi.fn(),
  postAsr: vi.fn(),
}));

vi.mock("./api", () => ({ postAsr: mocks.postAsr }));
vi.mock("./asrStream", () => ({ openAsrStream: mocks.openAsrStream }));

import { createLiveTranscription } from "./transcribe";
import { AsrQuotaError } from "./asrQuota";
import { clearToken, setToken } from "./authToken";

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
    expect(mocks.postAsr).toHaveBeenCalledWith(pcm, expect.any(AbortSignal), expect.any(Function), "disconnect");
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

  it("preserves the partial draft when HTTP recovery hits the quota", async () => {
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn(async () => { throw new Error("closed"); }) };
    mocks.openAsrStream.mockResolvedValue(stream);
    mocks.postAsr.mockRejectedValue(new AsrQuotaError());
    const live = createLiveTranscription();
    const callbacks = mocks.openAsrStream.mock.calls[0][0] as { onPartial: (text: string) => void };
    callbacks.onPartial("half a transcript");
    await expect(live.finish(new ArrayBuffer(1280))).rejects.toMatchObject({
      name: "AsrQuotaError", partialText: "half a transcript",
    });
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

  it.each([true, false])("only recovers an empty live final with audible PCM (audible=%s)", async audible => {
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockResolvedValue("") };
    mocks.openAsrStream.mockResolvedValue(stream);
    mocks.postAsr.mockResolvedValue("Yes.");
    const pcm = Int16Array.from({length: 3200}, (_, i) => audible ? 2000 * Math.sin(i * 0.1) : 0).buffer;
    const live = createLiveTranscription();
    live.send(pcm);
    await expect(live.finish(pcm)).resolves.toBe(audible ? "Yes." : "");
    expect(mocks.postAsr).toHaveBeenCalledTimes(audible ? 1 : 0);
    if (audible) expect(mocks.postAsr.mock.calls[0][3]).toBe("empty");
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "change owner"])("discards a late buffered transcription after %s", async action => {
    setToken("test-asr-owner");
    const controller = new AbortController();
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn().mockRejectedValue(new Error("connection closed")) };
    mocks.openAsrStream.mockResolvedValue(stream);
    let resolveAsr!: (text: string) => void;
    mocks.postAsr.mockImplementationOnce(() => new Promise<string>(resolve => { resolveAsr = resolve; }));
    const live = createLiveTranscription();
    try {
      const checked = expect(live.finish(new ArrayBuffer(1280), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(mocks.postAsr).toHaveBeenCalledOnce());
      if (action === "cancel") controller.abort();
      else setToken("test-asr-next-owner");
      resolveAsr("A late transcript");
      await checked;
    } finally { live.close(); clearToken(); }
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
