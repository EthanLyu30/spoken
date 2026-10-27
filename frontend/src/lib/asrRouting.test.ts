import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const direct = vi.hoisted(() => ({ transcribe: vi.fn(), open: vi.fn() }));
vi.mock("./directAsr", () => ({ transcribeDirect: direct.transcribe, openDirectAsrStream: direct.open }));
import { postAsr } from "./api";
import { openAsrStream } from "./asrStream";

describe("cloud ASR routing", () => {
  beforeEach(() => { direct.transcribe.mockReset(); direct.open.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => vi.unstubAllGlobals());

  it("uses a successful direct transcript without uploading the recording to the relay", async () => {
    direct.transcribe.mockResolvedValue("complete direct transcript");
    expect(await postAsr(new ArrayBuffer(1280))).toBe("complete direct transcript");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the whole clip when direct transcription needs the relay fallback", async () => {
    direct.transcribe.mockRejectedValue(new Error("network unavailable"));
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ text: "complete relay transcript" })));
    const pcm = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(await postAsr(pcm)).toBe("complete relay transcript");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/asr"), expect.objectContaining({ body: pcm }));
  });

  it("does not upload a cancelled utterance to either transport", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(postAsr(new ArrayBuffer(1280), controller.signal)).rejects.toThrow();
    expect(direct.transcribe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects the direct streaming connection when it is available", async () => {
    const stream = { send: vi.fn(), close: vi.fn(), finishUtterance: vi.fn() };
    direct.open.mockResolvedValue(stream);
    expect(await openAsrStream({ onPartial: vi.fn() })).toBe(stream);
  });
});
