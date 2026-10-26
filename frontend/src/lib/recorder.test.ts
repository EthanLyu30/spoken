import { afterEach, expect, it, vi } from "vitest";
import { startRecording } from "./recorder";
afterEach(() => vi.unstubAllGlobals());

it.each(["constructor", "processor"])("releases the acquired microphone when %s initialization fails", async (failure) => {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  class Context {
    constructor() { if (failure === "constructor") throw new Error("unsupported context"); }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return {}; }
    createScriptProcessor() { throw new Error("unsupported processor"); }
  }
  vi.stubGlobal("AudioContext", Context);
  await expect(startRecording()).rejects.toThrow(/unsupported/);
  expect(stop).toHaveBeenCalledOnce();
});
