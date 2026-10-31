import { afterEach, beforeEach, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ local: vi.fn() }));
vi.mock("./localSpeech/runtime", () => ({ isLocalSpeechModelReady: () => true, localSpeechCoordinator: { markError: vi.fn() } }));
vi.mock("./localSpeech/moonshine", () => ({ transcribeWithMoonshine: model.local }));
vi.mock("../store/voice", () => ({ useVoice: { getState: () => ({ engine: "local" }) } }));
import { transcribeSpeech } from "./transcribe";
import { setToken } from "./authToken";
const pcm = new Int16Array([1, -1]).buffer;
beforeEach(() => {
  model.local.mockReset(); setToken("transcription-owner-a");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/api/asr/session")
    ? new Response("{}", { status: 503 })
    : url.endsWith("/api/asr") ? new Response(JSON.stringify({ text: "same-owner relay" }))
    : new Response(null, { status: 202 })));
});
afterEach(() => vi.unstubAllGlobals());
it.each(["empty", "reject", "empty-aba", "reject-aba"])("does not authorize or upload delayed local audio after identity changes (%s)", async outcome => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  model.local.mockReturnValue(new Promise<string>((a, b) => { resolve = a; reject = b; }));
  const pending = transcribeSpeech(pcm);
  const checked = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(model.local).toHaveBeenCalledOnce());
  setToken("transcription-owner-b");
  if (outcome.endsWith("aba")) setToken("transcription-owner-a");
  if (outcome.startsWith("reject")) reject(new Error("worker evicted")); else resolve(" ");
  await checked;
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/asr"))).toEqual([]);
});
it("preserves real local-to-direct-to-relay fallback for the same owner", async () => {
  model.local.mockResolvedValue(" ");
  await expect(transcribeSpeech(pcm)).resolves.toBe("same-owner relay");
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/asr"), expect.objectContaining({ body: pcm }));
});
