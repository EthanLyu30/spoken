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

vi.mock("../store/voice", async actual => ({
  ...await actual<object>(),
  useVoice: {
    getState: () => ({
      engine: "local",
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
      kind: "unavailable",
    }),

}));

vi.mock("./localSpeech/runtime", () => ({
  isLocalSpeechModelReady: () => mocks.localReady,
  localSpeechCoordinator: { markError:vi.fn() },
}));

vi.mock("./localSpeech/kokoro", () => ({
  synthesizeWithKokoro: mocks.synthesizeWithKokoro,
}));

import { createSpeechQueue, speakText, stopSpeaking } from "./speech";
import { reportTiming } from "./telemetry";

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

describe("local speech queue cleanup", () => {
  it("marks buffered playback errors after start without changing the resolved playback contract", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    mocks.createObjectUrl.mockReturnValue("blob:qa-audio");
    mocks.synthesizeWithKokoro.mockResolvedValue({audio:new Float32Array([0]),sampleRate:24000});
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
    mocks.localReady = true;
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

  it("uses explicitly selected ready Kokoro without calling cloud", async () => {
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

  it("reports unavailable when local synthesis fails and browser voices are unavailable", async () => {
    mocks.localReady=true;mocks.synthesizeWithKokoro.mockRejectedValue(new Error("wasm failed"));
    const speaking=speakText("Fallback sentence");await speaking.done;
    expect(speaking.failed).toBe(true);expect(audioInstances).toHaveLength(0);expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
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

  it("synthesizes one complete local reply after final text, without switching sentence voices", async () => {
    mocks.localReady = true;
    mocks.createObjectUrl.mockReturnValue("blob:local-whole");
    mocks.synthesizeWithKokoro.mockResolvedValue({audio:new Float32Array([0,0.1]),sampleRate:24000});
    const q=createSpeechQueue("cafe");
    q.feed("First. ");
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(mocks.synthesizeWithKokoro).not.toHaveBeenCalled();
    const done=q.end("First. Second.");
    await vi.waitFor(()=>expect(audioInstances).toHaveLength(1));
    expect(mocks.synthesizeWithKokoro.mock.calls.map(call=>call[0])).toEqual(["First. Second."]);
    mocks.localReady=false;
    audioInstances[0].onended?.(); await done;
    expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();
  });

  it("global stop releases the active whole audio file", async () => {
    mocks.createObjectUrl.mockReturnValue("blob:whole");
    mocks.synthesizeWithKokoro.mockResolvedValue({audio:new Float32Array([0]),sampleRate:24000});
    const q=createSpeechQueue("cafe");
    const done=q.end("First. Second.");
    await vi.waitFor(()=>expect(audioInstances).toHaveLength(1));
    stopSpeaking(); await done;
    expect(mocks.revokeObjectUrl).toHaveBeenCalledWith("blob:whole");
  });

  it("does not replay a complete reply when local synthesis fails without browser voices", async () => {
    mocks.synthesizeWithKokoro.mockRejectedValue(new Error("worker failed"));
    const q=createSpeechQueue();await q.end("First. Second.");
    expect(q.failed).toBe(true);expect(mocks.synthesizeWithKokoro.mock.calls.map(call=>call[0])).toEqual(["First. Second."]);
    expect(mocks.fetchTtsUrl).not.toHaveBeenCalled();expect(audioInstances).toHaveLength(0);
  });

  it("filters the shared ASR, pronunciation, and native terminal telemetry contract by operation", () => {
    const fetcher=vi.fn().mockResolvedValue(new Response(null,{status:202}));vi.stubGlobal("fetch",fetcher);
    const options={
      reason:"native_error",error_code:"network",state_at_event:7,watchdog_budget_ms:60_000,
      state_before:1,state_after:7,voice_type:"local",voice_matched:true,
      pause_count:2,resume_count:1,paused_duration_ms:123.5,visibility_state:"hidden",
      stage:"open",attempt:2,fallback_reason:"timeout",audio_bytes:128_000,result_class:"nonempty",
      entry:"follow_read",private_text:"must not leave the browser",
    } as const;
    reportTiming("speech.native_end",250,options);
    reportTiming("asr.attempt",300,options);
    reportTiming("pronunciation.click_to_result",400,options);
    reportTiming("pronunciation.stop_to_result",500,{...options,entry:"turn_correction"});
    reportTiming("speech.complete",600,options);
    const bodies=fetcher.mock.calls.map(([,init])=>JSON.parse(init.body));
    expect(bodies[0]).toMatchObject({operation:"speech.native_end",reason:"native_error",error_code:"network",state_at_event:7,
      watchdog_budget_ms:60_000,pause_count:2,resume_count:1,paused_duration_ms:123.5,visibility_state:"hidden"});
    expect(bodies[1]).toMatchObject({operation:"asr.attempt",stage:"open",attempt:2,fallback_reason:"timeout",audio_bytes:128_000,result_class:"nonempty"});
    expect(bodies[2]).toMatchObject({operation:"pronunciation.click_to_result",entry:"follow_read",audio_bytes:128_000});
    expect(bodies[3]).toMatchObject({operation:"pronunciation.stop_to_result",entry:"turn_correction",audio_bytes:128_000});
    expect(bodies[0]).not.toHaveProperty("stage");expect(bodies[0]).not.toHaveProperty("audio_bytes");
    expect(bodies[0]).not.toHaveProperty("state_before");expect(bodies[0]).not.toHaveProperty("voice_type");
    expect(bodies[1]).not.toHaveProperty("reason");expect(bodies[1]).not.toHaveProperty("entry");
    expect(bodies[1]).not.toHaveProperty("state_at_event");expect(bodies[1]).not.toHaveProperty("voice_matched");
    expect(bodies[2]).not.toHaveProperty("stage");expect(bodies[2]).not.toHaveProperty("fallback_reason");
    for(const body of bodies){expect(body).not.toHaveProperty("private_text");}
    for(const key of ["reason","error_code","state_at_event","watchdog_budget_ms","pause_count","resume_count","paused_duration_ms","visibility_state","stage","attempt","fallback_reason","audio_bytes","result_class","entry"]){
      expect(bodies[4]).not.toHaveProperty(key);
    }
  });
});
