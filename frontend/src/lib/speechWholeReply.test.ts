import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchTtsUrl: vi.fn(), fetchTtsStream: vi.fn(), synthesize: vi.fn(), localReady: false,
  settings: { engine: "iflytek", vcn: null, speed: null, pitch: null, browserVoiceURI: null } }));
vi.mock("./api", () => ({ fetchTtsUrl: mocks.fetchTtsUrl, fetchTtsStream: mocks.fetchTtsStream }));
vi.mock("../store/voice", () => ({ useVoice: { getState: () => mocks.settings } }));
vi.mock("./localSpeech/runtime", () => ({ isLocalSpeechModelReady: () => mocks.localReady }));
vi.mock("./localSpeech/kokoro", () => ({ synthesizeWithKokoro: mocks.synthesize }));
import { createSpeechQueue, speakText, stopSpeaking } from "./speech";

class AudioDouble {
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(public src: string) { audios.push(this); }
}
class UtteranceDouble {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}
const audios: AudioDouble[] = [];
const utterances: UtteranceDouble[] = [];
const nativeCancel = vi.fn();
const revoke = vi.fn();
let samples: Record<string, unknown>[] = [];
beforeEach(() => {
  audios.length = 0; utterances.length = 0; samples = [];
  mocks.settings.engine = "iflytek"; mocks.localReady = false;
  mocks.fetchTtsUrl.mockReset().mockResolvedValue("blob:whole");
  mocks.fetchTtsStream.mockReset(); mocks.synthesize.mockReset(); nativeCancel.mockClear(); revoke.mockClear();
  vi.stubGlobal("AudioContext", undefined); vi.stubGlobal("Audio", AudioDouble);
  vi.stubGlobal("SpeechSynthesisUtterance", UtteranceDouble);
  vi.stubGlobal("speechSynthesis", { getVoices: () => [{name:"Device English",voiceURI:"device-en",lang:"en-US",localService:true}], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel:nativeCancel, speak:(u:UtteranceDouble)=>utterances.push(u) });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { samples.push(JSON.parse(String(init.body))); return new Response(null,{status:202}); });
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
});
afterEach(() => { stopSpeaking(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("buffers generated text and sends exactly one complete cloud request at end", async () => {
  const q = createSpeechQueue("cafe"); q.feed("First. "); q.feed("First. Second.");
  await new Promise(resolve => setTimeout(resolve,0));
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  const done = q.end("First. Second.");
  await vi.waitFor(()=>expect(audios).toHaveLength(1));
  expect(mocks.fetchTtsUrl.mock.calls.map(call=>call[0])).toEqual(["First. Second."]);
  expect(mocks.fetchTtsStream).not.toHaveBeenCalled();
  audios[0].onplaying?.(); audios[0].onended?.(); await done;
});

it("uses one native utterance for the final multi-sentence reply and preserves separate timings", async () => {
  mocks.settings.engine="browser";
  let now=100; vi.spyOn(performance,"now").mockImplementation(()=>now);
  const q=createSpeechQueue("cafe","a".repeat(32)); q.feed("First. ");
  await new Promise(resolve=>setTimeout(resolve,0)); expect(utterances).toHaveLength(0);
  const done=q.end("First. Corrected second.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].text).toBe("First. Corrected second.");
  now=500; utterances[0].onstart?.(); await q.started;
  now=2800; utterances[0].onend?.(); await done;
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.first_audio",duration_ms:400,engine:"browser"}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",duration_ms:2300,outcome:"ok",interaction_id:"a".repeat(32)}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",duration_ms:2700}));
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("does not synthesize or play when stopped before final text", async () => {
  const q=createSpeechQueue(); q.feed("First sentence. "); q.stop(); await q.end("First sentence. Second sentence.");
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled(); expect(audios).toHaveLength(0);
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.playback"}));
});

it("releases late full-audio results after stop without starting playback", async () => {
  let resolve: (url:string)=>void=()=>{};
  mocks.fetchTtsUrl.mockImplementation(()=>new Promise<string>(r=>{resolve=r;}));
  const q=createSpeechQueue(); const done=q.end("Whole reply.");
  await vi.waitFor(()=>expect(mocks.fetchTtsUrl).toHaveBeenCalledOnce());
  q.stop(); await done; resolve("blob:late");
  expect((mocks.fetchTtsUrl.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  await vi.waitFor(()=>expect(revoke).toHaveBeenCalledWith("blob:late")); expect(audios).toHaveLength(0);
});

it("keeps failed synthesis as a failure and never marks playback successful", async () => {
  const original=new Error("synthesis unavailable"); mocks.fetchTtsUrl.mockRejectedValue(original);
  await expect(createSpeechQueue().end("Whole reply.")).rejects.toBe(original);
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",outcome:"error"}));
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.playback"}));
});

it("classifies cancellation after native playback starts without repeating completion", async () => {
  mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("A whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1)); utterances[0].onstart?.(); await q.started;
  q.stop(); q.stop(); await done;
  await vi.waitFor(()=>expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"cancelled"})));
  expect(samples.filter(sample=>sample.operation==="speech.complete")).toHaveLength(1);
});

it("does not let a stale completed speech handle cancel its successor", async () => {
  mocks.settings.engine="browser";
  const first=speakText("First reply."); await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.(); utterances[0].onend?.(); await first.done;
  const next=speakText("Second reply."); await vi.waitFor(()=>expect(utterances).toHaveLength(2));
  const cancels=nativeCancel.mock.calls.length; first.stop(); expect(nativeCancel).toHaveBeenCalledTimes(cancels);
  utterances[1].onstart?.(); utterances[1].onend?.(); await next.done;
});

it("does not repeat a native reply through cloud after playback has started and failed", async () => {
  mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("One whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  utterances[0].onerror?.(); await done;
  expect(q.failed).toBe(true);
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",outcome:"error"}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"error"}));
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it.each(["end", "error"])("uses one whole cloud fallback when native reports %s without ever starting", async event => {
  mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("First sentence. Second sentence.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  if (event === "end") utterances[0].onend?.(); else utterances[0].onerror?.();
  await vi.waitFor(()=>expect(audios).toHaveLength(1));
  expect(mocks.fetchTtsUrl.mock.calls.map(call=>call[0])).toEqual(["First sentence. Second sentence."]);
  expect(mocks.fetchTtsStream).not.toHaveBeenCalled();
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.first_audio"}));
  audios[0].onplaying?.(); audios[0].onended?.(); await done;
  expect(q.failed).toBe(false);
  expect(samples.filter(sample=>sample.operation==="speech.complete")).toEqual([
    expect.objectContaining({engine:"xfyun",transport:"buffered",outcome:"ok"}),
  ]);
});

it("falls back to one whole cloud file when the device has no English voices", async () => {
  mocks.settings.engine="browser";
  vi.stubGlobal("speechSynthesis",{getVoices:()=>[],addEventListener:vi.fn(),removeEventListener:vi.fn(),cancel:nativeCancel,speak:vi.fn()});
  const q=createSpeechQueue(); const done=q.end("First sentence. Second sentence.");
  await vi.waitFor(()=>expect(audios).toHaveLength(1));
  expect(mocks.fetchTtsUrl.mock.calls.map(call=>call[0])).toEqual(["First sentence. Second sentence."]);
  audios[0].onplaying?.(); audios[0].onended?.(); await done;
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",engine:"xfyun",transport:"buffered",outcome:"ok"}));
});

it("cancels a silent native startup before one cloud fallback and ignores late native callbacks", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("A whole reply that must not get stuck.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  const lateStart=utterances[0].onstart!, lateEnd=utterances[0].onend!;
  await vi.advanceTimersByTimeAsync(5000);
  await vi.waitFor(()=>expect(audios).toHaveLength(1));
  expect(nativeCancel.mock.invocationCallOrder[1]).toBeLessThan(mocks.fetchTtsUrl.mock.invocationCallOrder[0]);
  expect(mocks.fetchTtsUrl).toHaveBeenCalledOnce();
  lateStart(); lateEnd();
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.first_audio"}));
  audios[0].onplaying?.(); audios[0].onended?.(); await done;
  expect(q.failed).toBe(false);
  expect(samples.filter(s=>s.operation==="speech.complete")).toEqual([expect.objectContaining({engine:"xfyun",outcome:"ok"})]);
});

it("does not start a fallback after cancellation during the native startup deadline", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("A complete reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  q.stop(); await done;
  const cancels=nativeCancel.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(nativeCancel).toHaveBeenCalledTimes(cancels);
  expect(samples.filter(s=>s.operation==="speech.complete")).toEqual([expect.objectContaining({outcome:"cancelled"})]);
});

it("settles a native completion timeout after sound starts without replaying through cloud", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const q=createSpeechQueue(); const done=q.end("A short complete reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(q.failed).toBe(true); await done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"error"}));
});
