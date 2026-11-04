import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetchTtsUrl: vi.fn(), fetchTtsStream: vi.fn(), synthesize: vi.fn(), modelError:vi.fn(), localReady: false,
  settings: { engine: "browser", vcn: null as string | null, speed: null as number | null, pitch: null as number | null, browserVoiceURI: null as string | null } }));
vi.mock("./api", () => ({ fetchTtsUrl: mocks.fetchTtsUrl, fetchTtsStream: mocks.fetchTtsStream }));
vi.mock("../store/voice", async actual => ({ ...await actual<object>(), useVoice: { getState: () => mocks.settings } }));
vi.mock("./localSpeech/runtime", () => ({ isLocalSpeechModelReady: () => mocks.localReady,localSpeechCoordinator:{markError:mocks.modelError} }));
vi.mock("./localSpeech/kokoro", () => ({ synthesizeWithKokoro: mocks.synthesize }));
import { createSpeechQueue, speakText, stopSpeaking, primeBrowserVoices, listBrowserVoices, prepareSpeech } from "./speech";

class AudioDouble {
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor(public src: string) { audios.push(this); }
}
class UtteranceDouble {
  rate = 1; pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event?: { error?: string }) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  constructor(public text: string) {}
}
const audios: AudioDouble[] = [];
const utterances: UtteranceDouble[] = [];
const nativeCancel = vi.fn();
const revoke = vi.fn();
let samples: Record<string, unknown>[] = [];
beforeEach(() => {
  audios.length = 0; utterances.length = 0; samples = [];
  mocks.settings.engine = "browser"; mocks.settings.vcn = null; mocks.settings.browserVoiceURI = null; mocks.settings.speed = null; mocks.settings.pitch = null; mocks.localReady = false;
  mocks.fetchTtsUrl.mockReset().mockResolvedValue("blob:whole");
  mocks.fetchTtsStream.mockReset(); mocks.synthesize.mockReset(); mocks.modelError.mockReset(); nativeCancel.mockClear(); revoke.mockClear();
  vi.stubGlobal("AudioContext", undefined); vi.stubGlobal("Audio", AudioDouble);
  vi.stubGlobal("SpeechSynthesisUtterance", UtteranceDouble);
  vi.stubGlobal("speechSynthesis", { getVoices: () => [{name:"Device English",voiceURI:"device-en",lang:"en-US",localService:true}], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel:nativeCancel, speak:(u:UtteranceDouble)=>utterances.push(u) });
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { samples.push(JSON.parse(String(init.body))); return new Response(null,{status:202}); });
  Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
});
afterEach(() => { stopSpeaking(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("prepares discovery with no requests and uses current final preferences", async () => {
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);const preparation=prepareSpeech();await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();mocks.settings.speed=42;mocks.settings.pitch=60;
  const speaking=speakText("Final whole reply.","cafe",{preparation});await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].rate).toBeCloseTo(1.036);expect(utterances[0].pitch).toBeCloseTo(1.14);
  utterances[0].onstart?.();utterances[0].onend?.();await speaking.done;expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});
it("keeps available browser voices free of cloud preparation requests", async () => {
  mocks.settings.engine="browser";
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  const preparation=prepareSpeech();
  await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();
  preparation.dispose();
});

it("uses a late browser voice without preparing a cloud connection", async () => {
  vi.useFakeTimers();mocks.settings.engine="browser";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([]);
  const fetcher=vi.fn(async()=>Response.json({ticket:"e".repeat(32)}));vi.stubGlobal("fetch",fetcher);
  const preparation=prepareSpeech();
  await vi.advanceTimersByTimeAsync(600);
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([{name:"Late Natural",voiceURI:"late",lang:"en-US"} as SpeechSynthesisVoice]);
  const speaking=speakText("Final reply.","cafe",{preparation});
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances).toHaveLength(1);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining("/api/tts"),expect.anything());
  utterances[0].onstart?.();utterances[0].onend?.();await speaking.done;
});

it("buffers generated text and speaks exactly one complete native utterance at end", async () => {
  const q=createSpeechQueue();q.feed("First. ");q.feed("First. Second.");await Promise.resolve();
  expect(utterances).toHaveLength(0);const done=q.end("First. Second.");await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].text).toBe("First. Second.");utterances[0].onstart?.();utterances[0].onend?.();await done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();expect(mocks.fetchTtsStream).not.toHaveBeenCalled();
});
it("starts the first complete browser sentence before the final reply arrives", async () => {
  const q=createSpeechQueue();q.startEarly?.();
  q.feed("First sentence. Partial answer");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].text).toBe("First sentence.");
  utterances[0].onstart?.();
  utterances[0].onend?.();

  const done=q.end("First sentence. Second sentence.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(2));
  expect(utterances[1].text).toBe("Second sentence.");
  utterances[1].onstart?.();utterances[1].onend?.();
  await done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it.each(["The price is $3.", "The price is $3. "])("does not speak a decimal split across streaming chunks: %s", async partial => {
  vi.useFakeTimers();
  const q = createSpeechQueue();
  q.startEarly?.();
  q.feed(partial);
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances).toHaveLength(0);

  q.feed("The price is $3.50 per cup. Anything else?");
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances.map(u => u.text)).toEqual(["The price is $3.50 per cup."]);
  utterances[0].onstart?.(); utterances[0].onend?.();
  const done = q.end("The price is $3.50 per cup. Anything else?");
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances[1].text).toBe("Anything else?");
  utterances[1].onstart?.(); utterances[1].onend?.();
  await done;
});

it("waits for the final signal before speaking a single sentence at the buffer edge", async () => {
  vi.useFakeTimers();
  const q = createSpeechQueue();
  q.startEarly?.();
  q.feed("A coffee costs $3.50.");
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances).toHaveLength(0);
  const done = q.end("A coffee costs $3.50.");
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances.map(u => u.text)).toEqual(["A coffee costs $3.50."]);
  utterances[0].onstart?.(); utterances[0].onend?.();
  await done;
});

it("overlaps empty browser discovery with generation so final text has no repeated 500 ms wait", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const subscribe=vi.fn(), unsubscribe=vi.fn();
  vi.stubGlobal("speechSynthesis",{getVoices:()=>[],addEventListener:subscribe,removeEventListener:unsubscribe,cancel:nativeCancel,speak:vi.fn()});
  const q=createSpeechQueue(); q.feed("Partial text.");
  expect(subscribe).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  const done=q.end("Final whole reply.");
  await vi.advanceTimersByTimeAsync(0);
  await done;expect(q.failed).toBe(true);expect(q.status?.phase).toBe("error");expect(audios).toHaveLength(0);
});

it("rechecks late Natural voices after an early empty discovery result", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const voices=vi.fn<()=>SpeechSynthesisVoice[]>().mockReturnValue([]);
  vi.spyOn(window.speechSynthesis,"getVoices").mockImplementation(voices);
  const q=createSpeechQueue();
  await vi.advanceTimersByTimeAsync(700);
  voices.mockReturnValue([{name:"Microsoft Jenny Online (Natural)",voiceURI:"late-natural",lang:"en-US"} as SpeechSynthesisVoice]);
  const done=q.end("A final complete sentence.");
  await vi.advanceTimersByTimeAsync(0);
  expect(utterances).toHaveLength(1);
  expect(utterances[0].voice?.voiceURI).toBe("late-natural");
  utterances[0].onstart?.(); utterances[0].onend?.(); await done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("does not select browser mode from an English voice that disappeared during generation", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const voices=vi.spyOn(window.speechSynthesis,"getVoices");
  const q=createSpeechQueue();
  await vi.advanceTimersByTimeAsync(700);
  voices.mockReturnValue([]);
  const done=q.end("A complete reply.");
  await vi.advanceTimersByTimeAsync(500);
  expect(utterances).toHaveLength(0);
  await done;expect(q.failed).toBe(true);expect(audios).toHaveLength(0);
});

it("waits only the unfinished discovery budget after final text and cancels that wait promptly", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([]);
  const q=createSpeechQueue();
  await vi.advanceTimersByTimeAsync(200);
  const done=q.end("A whole reply.");
  await vi.advanceTimersByTimeAsync(299);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await done;expect(q.failed).toBe(true);expect(audios).toHaveLength(0);
  const next=createSpeechQueue(); const cancelled=next.end("Another whole reply.");
  await vi.advanceTimersByTimeAsync(50);
  next.stop(); await cancelled;
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("stop releases pending browser discovery listeners and timers before final text", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const subscribe=vi.fn(), unsubscribe=vi.fn();
  vi.stubGlobal("speechSynthesis",{getVoices:()=>[],addEventListener:subscribe,removeEventListener:unsubscribe,cancel:nativeCancel,speak:vi.fn()});
  const q=createSpeechQueue();
  expect(subscribe).toHaveBeenCalledOnce();
  q.stop(); await q.end("Discard this reply.");
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(6000);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(utterances).toHaveLength(0);
});

it("reports final-text, native-start and remaining-resolution timing without redefining first_audio", async () => {
  mocks.settings.engine="browser";
  let now=100; vi.spyOn(performance,"now").mockImplementation(()=>now);
  const q=createSpeechQueue("cafe","b".repeat(32));
  now=1100; const done=q.end("Whole reply after generation.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  now=1300; utterances[0].onstart?.();
  now=2000; utterances[0].onend?.(); await done;
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.first_audio",duration_ms:1200}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.final_text_to_audio",duration_ms:200,interaction_id:"b".repeat(32)}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.native_start",duration_ms:200}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.voice_resolution",duration_ms:0}));
});

it("local inference and actual onplaying remain separate from the play promise", async () => {
  mocks.settings.engine="local";mocks.localReady=true;Object.defineProperty(URL,"createObjectURL",{configurable:true,value:()=>"blob:local"});
  let now=100;vi.spyOn(performance,"now").mockImplementation(()=>now);
  let finish:(output:{audio:Float32Array;sampleRate:number})=>void=()=>{};mocks.synthesize.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const q=createSpeechQueue();now=500;const done=q.end("One complete WAV.");await vi.waitFor(()=>expect(mocks.synthesize).toHaveBeenCalledOnce());
  now=1000;finish({audio:new Float32Array([0]),sampleRate:24000});await vi.waitFor(()=>expect(audios).toHaveLength(1));
  expect(samples.some(s=>["speech.play_start","speech.first_audio"].includes(String(s.operation)))).toBe(false);
  now=1100;audios[0].onplaying?.();audios[0].onplaying?.();now=1500;audios[0].onended?.();await done;
  expect(samples.filter(s=>s.operation==="speech.play_start")).toEqual([expect.objectContaining({duration_ms:100,engine:"local"})]);
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.first_audio",duration_ms:1000}));
});
it("uses browser speech immediately while the selected local model is still loading",async()=>{
  mocks.settings.engine="local";
  const q=createSpeechQueue(); const done=q.end("Still a complete reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(q.status).toMatchObject({effectiveEngine:"browser",fallbackReason:"local-unavailable"});
  utterances[0].onstart?.(); utterances[0].onend?.(); await done;
  expect(mocks.synthesize).not.toHaveBeenCalled();
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("marks failed local inference unavailable and recovers with an available browser voice",async()=>{
  mocks.settings.engine="local";mocks.localReady=true;
  const error=new Error("local inference timed out");
  mocks.synthesize.mockRejectedValueOnce(error);
  const q=createSpeechQueue();const done=q.end("Recover without a cloud request.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(mocks.modelError).toHaveBeenCalledWith("kokoro",error);
  utterances[0].onstart?.();utterances[0].onend?.();await done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
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

it("prefers Chrome's natural Google English voice over a traditional local system voice", async () => {
  mocks.settings.engine="browser";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([
    {name:"Microsoft David Desktop",voiceURI:"desktop",lang:"en-US",localService:true},
    {name:"Google US English",voiceURI:"google",lang:"en-US",localService:false},
  ] as SpeechSynthesisVoice[]);
  const q=createSpeechQueue(); const done=q.end("A natural whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].voice?.voiceURI).toBe("google");
  utterances[0].onstart?.(); utterances[0].onend?.(); await done;
});

it("keeps late Edge Natural voices discoverable after initial system voices and unsubscribes on cleanup",()=>{
  const events=new EventTarget();
  let voices=[{name:"Microsoft David Desktop",voiceURI:"desktop",lang:"en-US",localService:true}] as SpeechSynthesisVoice[];
  vi.stubGlobal("speechSynthesis",{getVoices:()=>voices,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)});
  const updates:string[][]=[];
  const dispose=primeBrowserVoices(()=>updates.push(listBrowserVoices().map(voice=>voice.voiceURI)));
  voices=[...voices,{name:"Microsoft Jenny Online (Natural)",voiceURI:"edge-jenny",lang:"en-US",localService:false} as SpeechSynthesisVoice];
  events.dispatchEvent(new Event("voiceschanged"));
  expect(updates).toEqual([["desktop"],["desktop","edge-jenny"]]);
  if(typeof dispose === "function") dispose();
  events.dispatchEvent(new Event("voiceschanged"));
  expect(updates).toHaveLength(2);
});

it("uses Edge's Microsoft Natural voice as one whole native utterance without cloud synthesis",async()=>{
  mocks.settings.engine="browser";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([
    {name:"Microsoft David Desktop",voiceURI:"desktop",lang:"en-US",localService:true},
    {name:"Microsoft Jenny Online (Natural)",voiceURI:"edge-jenny",lang:"en-US",localService:false},
  ] as SpeechSynthesisVoice[]);
  const speech=speakText("One complete answer. Another sentence.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].voice?.voiceURI).toBe("edge-jenny");
  expect(utterances[0].text).toBe("One complete answer. Another sentence.");
  utterances[0].onstart?.();utterances[0].onend?.();await speech.done;
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("respects an explicit system voice even when natural English voices are available", async () => {
  mocks.settings.engine="browser"; mocks.settings.browserVoiceURI="desktop";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([
    {name:"Google US English",voiceURI:"google",lang:"en-US",localService:false},
    {name:"Microsoft David Desktop",voiceURI:"desktop",lang:"en-US",localService:true},
  ] as SpeechSynthesisVoice[]);
  const q=createSpeechQueue(); const done=q.end("My chosen voice.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].voice?.voiceURI).toBe("desktop");
  utterances[0].onstart?.(); utterances[0].onend?.(); await done;
});

it("reports native startup failure without pretending another voice played", async () => {
  const q=createSpeechQueue();const done=q.end("One complete reply.");await vi.waitFor(()=>expect(utterances).toHaveLength(1));utterances[0].onend?.();await done;
  expect(q.status).toMatchObject({effectiveEngine:"browser",fallbackReason:"browser-start-failed",phase:"error"});expect(q.failed).toBe(true);
  expect(audios).toHaveLength(0);expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});
it("does not synthesize or play when stopped before final text", async () => {
  const q=createSpeechQueue(); q.feed("First sentence. "); q.stop(); await q.end("First sentence. Second sentence.");
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled(); expect(audios).toHaveLength(0);
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.playback"}));
});

it("releases late local audio results after stop without starting playback", async () => {
  mocks.settings.engine="local";mocks.localReady=true;Object.defineProperty(URL,"createObjectURL",{configurable:true,value:()=>"blob:late"});
  let resolve:(output:{audio:Float32Array;sampleRate:number})=>void=()=>{};mocks.synthesize.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const q=createSpeechQueue();const done=q.end("Whole reply.");await vi.waitFor(()=>expect(mocks.synthesize).toHaveBeenCalledOnce());q.stop();await done;
  resolve({audio:new Float32Array([0]),sampleRate:24000});await vi.waitFor(()=>expect(revoke).toHaveBeenCalledWith("blob:late"));expect(audios).toHaveLength(0);
});
it("keeps failed local inference without an English voice as a failure", async () => {
  vi.useFakeTimers();mocks.settings.engine="local";mocks.localReady=true;vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([]);
  mocks.synthesize.mockRejectedValue(new Error("unavailable"));const q=createSpeechQueue();const done=q.end("Whole reply.");await vi.advanceTimersByTimeAsync(500);await done;
  expect(q.failed).toBe(true);expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",outcome:"error"}));
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.playback"}));expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});
it("classifies cancellation after native playback starts without repeating completion", async () => {
  mocks.settings.engine="browser";
  const synth=window.speechSynthesis;
  Object.assign(synth,{paused:false,speaking:true,pending:true});
  const q=createSpeechQueue(); const done=q.end("A whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1)); utterances[0].onstart?.(); await q.started;
  Object.assign(synth,{paused:false,speaking:true,pending:true});
  nativeCancel.mockImplementationOnce(()=>Object.assign(synth,{speaking:false,pending:false}));
  q.stop(); q.stop(); await done;
  await vi.waitFor(()=>expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"cancelled"})));
  expect(samples.filter(sample=>sample.operation==="speech.complete")).toHaveLength(1);
  expect(samples.filter(sample=>sample.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"cancelled",outcome:"cancelled",state_at_event:6,
  })]);
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
  const q=createSpeechQueue(); const done=q.end("Private whole reply text.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  utterances[0].onerror?.({error:"synthesis-failed"}); await done;
  expect(q.failed).toBe(true);
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",outcome:"error"}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"error"}));
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"native_error",error_code:"synthesis-failed",outcome:"error",
  })]);
  expect(JSON.stringify(samples)).not.toContain("Private whole reply text.");
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it.each(["end", "error"])("reports an error when native reports %s without starting", async event => {
  const q=createSpeechQueue();const done=q.end("First sentence. Second sentence.");await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  if(event==="end")utterances[0].onend?.();else utterances[0].onerror?.();await done;
  expect(q.failed).toBe(true);expect(q.status?.phase).toBe("error");expect(audios).toHaveLength(0);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();expect(mocks.fetchTtsStream).not.toHaveBeenCalled();
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.first_audio"}));
  expect(samples.filter(s=>s.operation==="speech.complete")).toEqual([expect.objectContaining({engine:"browser",outcome:"error"})]);
});
it("reports unavailable for a device with only non-English voices", async () => {
  vi.useFakeTimers();vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([{lang:"zh-CN"} as SpeechSynthesisVoice]);
  const q=createSpeechQueue();const done=q.end("First sentence. Second sentence.");await vi.advanceTimersByTimeAsync(500);await done;
  expect(q.failed).toBe(true);expect(q.status).toMatchObject({phase:"error",effectiveEngine:null,fallbackReason:"browser-unavailable"});
  expect(utterances).toHaveLength(0);expect(audios).toHaveLength(0);expect(mocks.synthesize).not.toHaveBeenCalled();expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.complete",outcome:"error"}));
});
it("cancels a silent native startup and ignores late callbacks without replay", async () => {
  vi.useFakeTimers();const q=createSpeechQueue();const done=q.end("A whole reply.");await vi.advanceTimersByTimeAsync(0);
  const lateStart=utterances[0].onstart!,lateEnd=utterances[0].onend!;await vi.advanceTimersByTimeAsync(5000);await done;lateStart();lateEnd();
  expect(nativeCancel).toHaveBeenCalled();expect(q.failed).toBe(true);expect(audios).toHaveLength(0);expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(samples).not.toContainEqual(expect.objectContaining({operation:"speech.first_audio"}));
  expect(samples.filter(s=>s.operation==="speech.complete")).toEqual([expect.objectContaining({engine:"browser",outcome:"error"})]);
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
  const resume=vi.fn();
  Object.assign(window.speechSynthesis,{paused:false,speaking:true,pending:false,resume});
  const q=createSpeechQueue(); const done=q.end("A short complete reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(q.failed).toBe(true); await done;
  expect(resume).not.toHaveBeenCalled();
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.playback",outcome:"error"}));
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"completion_timeout",outcome:"error",state_at_event:2,watchdog_budget_ms:60_000,visibility_state:"visible",
  })]);
});

it("resumes a visible paused utterance once at the watchdog and accepts a terminal during grace", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const synth=window.speechSynthesis;
  const resume=vi.fn(()=>{Object.assign(synth,{paused:false});});
  Object.assign(synth,{paused:false,speaking:true,pending:false,resume});
  const q=createSpeechQueue();const done=q.end("A paused complete reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  Object.assign(synth,{paused:true});utterances[0].onpause?.();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(resume).toHaveBeenCalledOnce();expect(q.failed).toBe(false);
  Object.assign(synth,{speaking:false});utterances[0].onend?.();await done;
  expect(resume).toHaveBeenCalledOnce();
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"end",outcome:"ok",watchdog_budget_ms:60_000,pause_count:1,resume_count:1,paused_duration_ms:60_000,visibility_state:"visible",
  })]);
});

it("does not extend the watchdog for a paused utterance while the page is hidden", async () => {
  vi.useFakeTimers();mocks.settings.engine="browser";
  vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
  const synth=window.speechSynthesis;const resume=vi.fn();
  Object.assign(synth,{paused:false,speaking:true,pending:false,resume});
  const q=createSpeechQueue();const done=q.end("A hidden paused reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();Object.assign(synth,{paused:true});utterances[0].onpause?.();
  await vi.advanceTimersByTimeAsync(60_000);await done;
  expect(resume).not.toHaveBeenCalled();expect(q.failed).toBe(true);
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"completion_timeout",outcome:"error",visibility_state:"hidden",resume_count:0,
  })]);
});

it("reports completion_timeout only after the single two-second paused recovery grace fails", async () => {
  vi.useFakeTimers();mocks.settings.engine="browser";
  const synth=window.speechSynthesis;const resume=vi.fn();
  Object.assign(synth,{paused:false,speaking:true,pending:false,resume});
  const q=createSpeechQueue();const done=q.end("A stuck paused reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();Object.assign(synth,{paused:true});utterances[0].onpause?.();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(resume).toHaveBeenCalledOnce();expect(q.failed).toBe(false);
  await vi.advanceTimersByTimeAsync(1_999);expect(q.failed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await done;
  expect(q.failed).toBe(true);expect(resume).toHaveBeenCalledOnce();
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"completion_timeout",outcome:"error",pause_count:1,resume_count:1,paused_duration_ms:62_000,
  })]);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});


it("recovers a paused idle synthesizer without cancelling and reports bounded native state", async () => {
  mocks.settings.engine = "browser";
  const synth = window.speechSynthesis;
  Object.assign(synth, { paused: true, speaking: false, pending: false, resume: vi.fn(() => { Object.assign(synth, { paused: false }); }) });
  const q = createSpeechQueue(); const done = q.end("Whole reply.");
  await vi.waitFor(() => expect(utterances).toHaveLength(1));
  expect(synth.resume).toHaveBeenCalledOnce(); expect(nativeCancel).not.toHaveBeenCalled();
  utterances[0].onstart?.(); utterances[0].onend?.(); await done;
  expect(samples.filter(s => s.operation === "speech.native_start")).toEqual([expect.objectContaining({ reason: "started", outcome: "ok", state_before: 1, state_after: 0, voice_type: "local" })]);
});

it("retains a native failure diagnostic and failed final outcome", async () => {
  const q=createSpeechQueue();const done=q.end("Whole reply.");await vi.waitFor(()=>expect(utterances).toHaveLength(1));utterances[0].onerror?.();await done;
  expect(samples.filter(s=>s.operation==="speech.native_start")).toEqual([expect.objectContaining({reason:"speech_error",error_code:"unknown",outcome:"error"})]);
  expect(q.failed).toBe(true);expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});
it("prepares discovery independently of active playback and consumes current preferences", async () => {
  mocks.settings.engine = "browser";
  const first = speakText("Replay.");
  await vi.waitFor(() => expect(utterances).toHaveLength(1));
  utterances[0].onstart?.();
  const cancels = nativeCancel.mock.calls.length;
  const preparation = prepareSpeech();
  expect(nativeCancel).toHaveBeenCalledTimes(cancels);
  expect(utterances[0].onend).not.toBeNull();
  expect(utterances).toHaveLength(1); expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  mocks.settings = {...mocks.settings, engine: "browser", speed:70};
  const next = speakText("New reply.", "cafe", {preparation, interactionId: "a".repeat(32), submittedAt: performance.now()});
  await vi.waitFor(() => expect(utterances).toHaveLength(2));
  expect(utterances[1].rate).toBeCloseTo(1.26);
  utterances[1].onstart?.();utterances[1].onend?.();await next.done;await first.done;
  expect(samples).toContainEqual(expect.objectContaining({operation: "speech.request_to_audio", interaction_id: "a".repeat(32)}));
});


it.each(["timeout", "end", "exception", "cancelled"])("records exactly one native startup outcome for %s including stale callbacks", async reason => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  if (reason === "exception") vi.spyOn(window.speechSynthesis,"speak").mockImplementation(() => { throw new Error("Private device detail"); });
  const q=createSpeechQueue(); const done=q.end("A whole reply.");
  await vi.advanceTimersByTimeAsync(0);
  const lateStart=utterances[0]?.onstart;
  if (reason === "timeout") await vi.advanceTimersByTimeAsync(5000);
  if (reason === "end") utterances[0].onend?.();
  if (reason === "cancelled") q.stop();
  await vi.advanceTimersByTimeAsync(0);
  lateStart?.();

  await done;
  const diagnostics=samples.filter(s=>s.operation==="speech.native_start");
  expect(diagnostics).toEqual([expect.objectContaining({outcome:reason==="cancelled"?"cancelled":"error",reason:{timeout:"startup_timeout",end:"end_before_start",exception:"speak_exception",cancelled:"cancelled"}[reason]})]);
  expect(diagnostics[0]).not.toHaveProperty("voice_matched");
  expect(diagnostics[0]).not.toHaveProperty("state_before");
  expect(samples.filter(s=>s.operation==="speech.native_end")).toHaveLength(0);
  expect(JSON.stringify(diagnostics)).not.toContain("Private");
});
it("records start and one terminal for an utterance that starts then fails, preserving the explicit voice match", async () => {
  mocks.settings.engine="browser"; mocks.settings.browserVoiceURI="device-en";
  const q=createSpeechQueue(); const done=q.end("A whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  const start=utterances[0].onstart!; start(); start(); utterances[0].onerror?.(); await done;
  expect(samples.filter(s=>s.operation==="speech.native_start")).toEqual([expect.objectContaining({reason:"started",outcome:"ok",voice_matched:true})]);
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({reason:"native_error",error_code:"unknown",outcome:"error"})]);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
});

it("reports one normal native terminal with bounded playback diagnostics and ignores stale callbacks", async () => {
  const synth = window.speechSynthesis;
  Object.assign(synth, {paused:false, speaking:true, pending:false});
  const q=createSpeechQueue(); const done=q.end("A whole reply whose text must stay private.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  const lateStart=utterances[0].onstart!, lateEnd=utterances[0].onend!, lateError=utterances[0].onerror!;
  lateStart(); lateStart();
  Object.assign(synth, {speaking:false});
  lateEnd(); await done;
  lateStart(); lateEnd(); lateError({error:"network"});
  expect(samples.filter(s=>s.operation==="speech.native_start")).toHaveLength(1);
  expect(samples.filter(s=>s.operation==="speech.native_end")).toEqual([expect.objectContaining({
    reason:"end", outcome:"ok", state_at_event:0, watchdog_budget_ms:60_000,
    pause_count:0, resume_count:0, paused_duration_ms:0, visibility_state:"visible",
  })]);
  expect(JSON.stringify(samples)).not.toContain("A whole reply whose text must stay private.");
});
it("amortizes standalone empty discovery without owning playback and cancels its resources", async () => {
  vi.useFakeTimers(); mocks.settings.engine="browser";
  const subscribe=vi.fn(), unsubscribe=vi.fn();
  vi.stubGlobal("speechSynthesis",{getVoices:()=>[],addEventListener:subscribe,removeEventListener:unsubscribe,cancel:nativeCancel,speak:vi.fn()});
  const controller=new AbortController(); const discarded=prepareSpeech(controller.signal);
  expect(subscribe).toHaveBeenCalledOnce(); controller.abort();
  expect(unsubscribe).toHaveBeenCalledOnce(); expect(discarded.consume()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
  const preparation=prepareSpeech();
  await vi.advanceTimersByTimeAsync(600);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled(); expect(nativeCancel).not.toHaveBeenCalled();
  const speech=speakText("Final reply.","cafe",{preparation});
  await vi.advanceTimersByTimeAsync(0);
  await speech.done;expect(speech.failed).toBe(true);expect(audios).toHaveLength(0);
  expect(preparation.consume()).toBeUndefined();
});
it("selects the latest English voice and settings after standalone preparation", async () => {
  mocks.settings.engine="browser";
  const preparation=prepareSpeech();
  mocks.settings={...mocks.settings,browserVoiceURI:"late-natural",speed:70,pitch:80};
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([
    {name:"Non-English Natural",voiceURI:"other",lang:"zh-CN"},
    {name:"Late Natural",voiceURI:"late-natural",lang:"en-US"},
  ] as SpeechSynthesisVoice[]);
  const speech=speakText("Final reply.","cafe",{preparation});
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  expect(utterances[0].voice?.voiceURI).toBe("late-natural");
  expect(utterances[0].rate).toBeCloseTo(1.26); expect(utterances[0].pitch).toBeCloseTo(1.32);
  utterances[0].onstart?.();utterances[0].onend?.();await speech.done;
});


it("preserves native_start speak-to-callback timing while recovery remains in first_audio", async () => {
  mocks.settings.engine="browser";
  let now=100;vi.spyOn(performance,"now").mockImplementation(()=>now);
  Object.assign(window.speechSynthesis,{paused:true,speaking:false,pending:false,resume:()=>{now=200;Object.assign(window.speechSynthesis,{paused:false});}});
  const q=createSpeechQueue();const done=q.end("Whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));
  now=300;utterances[0].onstart?.();utterances[0].onend?.();await done;
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.native_start",duration_ms:100,reason:"started",state_before:1}));
  expect(samples).toContainEqual(expect.objectContaining({operation:"speech.first_audio",duration_ms:200}));
});

it("browser-only policy reports missing English voices without cloud requests", async () => {
  vi.useFakeTimers();mocks.settings.engine="browser";
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([]);
  const q=createSpeechQueue();const done=q.end("A whole reply.");
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  await done;expect(q.failed).toBe(true);
  expect(q.status).toMatchObject({phase:"error",effectiveEngine:null,fallbackReason:"browser-unavailable"});
});
it("browser-only policy keeps native startup errors as failures without cloud retry", async () => {
  mocks.settings.engine="browser";const q=createSpeechQueue();const done=q.end("A whole reply.");
  await vi.waitFor(()=>expect(utterances).toHaveLength(1));utterances[0].onerror?.();
  await Promise.resolve();await Promise.resolve();
  expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  await done;expect(q.failed).toBe(true);expect(q.status?.phase).toBe("error");
});
it("browser-only preparation does not request cloud connections without English voices", async () => {
  mocks.settings.engine="browser";vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValue([]);
  const fetcher=vi.fn(async()=>Response.json({ticket:"d".repeat(32)}));vi.stubGlobal("fetch",fetcher);
  const preparation=prepareSpeech();await Promise.resolve();
  expect(fetcher).not.toHaveBeenCalled();preparation.dispose();
});

it("does not use an implicit default when English voices vanish at final selection",async()=>{
  const english={name:"Device English",voiceURI:"device-en",lang:"en-US"} as SpeechSynthesisVoice;
  vi.spyOn(window.speechSynthesis,"getVoices").mockReturnValueOnce([english]).mockReturnValueOnce([english]).mockReturnValue([]);
  const q=createSpeechQueue();const done=q.end("A complete reply.");
  await Promise.resolve();await Promise.resolve();
  expect(utterances).toHaveLength(0);await done;
  expect(q.failed).toBe(true);expect(q.status).toMatchObject({phase:"error",effectiveEngine:null,fallbackReason:"browser-unavailable"});
});
