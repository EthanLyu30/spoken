import { afterEach, beforeEach, expect, it, vi } from "vitest";
const backends = vi.hoisted(() => ({ cloud: vi.fn(), local: vi.fn() }));
vi.mock("./api", () => ({ postAsr: backends.cloud }));
vi.mock("./localSpeech/runtime", () => ({ isLocalSpeechModelReady: () => true,localSpeechCoordinator:{markError:vi.fn()} }));
vi.mock("./localSpeech/moonshine", () => ({ transcribeWithMoonshine: backends.local }));
vi.mock("../store/voice", () => ({ useVoice: { getState: () => ({ engine: "local" }) } }));
import { transcribeSpeech } from "./transcribe";
import { bindInteraction } from "./telemetry";

let samples: Record<string, unknown>[];
const pcm = new Int16Array([0, 2000, -2000]).buffer;
beforeEach(() => {
  samples = [];
  backends.cloud.mockReset().mockResolvedValue("cloud transcript");
  backends.local.mockReset().mockResolvedValue("local transcript");
  vi.stubGlobal("fetch", async (_url: string, options: RequestInit) => {
    samples.push(JSON.parse(String(options.body)));
    return new Response(null, { status: 202 });
  });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps an utterance selected for cloud on cloud even if a local model is ready", async () => {
  const controller = new AbortController();
  bindInteraction(controller.signal, "d".repeat(32));
  await expect(transcribeSpeech(pcm, controller.signal, "cloud")).resolves.toBe("cloud transcript");
  expect(samples).toEqual([expect.objectContaining({ operation: "asr.transcribe", engine: "xfyun", transport: "buffered", outcome: "ok", interaction_id: "d".repeat(32) })]);
});

it("preserves automatic local recognition and measures the actual local engine", async () => {
  await expect(transcribeSpeech(pcm)).resolves.toBe("local transcript");
  expect(samples).toEqual([expect.objectContaining({ operation: "asr.transcribe", engine: "local", transport: "local", outcome: "ok" })]);
});

it("preserves cloud failures and reports an error without transcript content", async () => {
  const original = new Error("private provider failure");
  backends.cloud.mockRejectedValue(original);
  await expect(transcribeSpeech(pcm, undefined, "cloud")).rejects.toBe(original);
  expect(samples).toEqual([expect.objectContaining({ operation: "asr.transcribe", engine: "xfyun", outcome: "error" })]);
  expect(JSON.stringify(samples)).not.toMatch(/private|transcript/);
});

it("reports an aborted cloud attempt as cancelled and never returns its late transcript", async () => {
  const controller = new AbortController();
  backends.cloud.mockImplementation(async () => { controller.abort(); return "late private transcript"; });
  await expect(transcribeSpeech(pcm, controller.signal, "cloud")).rejects.toMatchObject({ name: "AbortError" });
  expect(samples).toEqual([expect.objectContaining({ operation: "asr.transcribe", outcome: "cancelled" })]);
});
