import { describe, expect, it, vi } from "vitest";
import { createLocalSpeechBootstrap } from "./bootstrap";

describe("local speech bootstrap", () => {
  it("does not start deferred downloads after switching away, and allows re-enabling", async () => {
    let enabled=true;
    let idleTask=()=>{};
    const preload=vi.fn(async()=>{});
    const start=createLocalSpeechBootstrap({enabled:()=>enabled,schedule:task=>{idleTask=task;return()=>{};},hasEnglishBrowserVoice:async()=>false,preload});
    start();
    enabled=false;
    idleTask();
    await Promise.resolve(); await Promise.resolve();
    expect(preload).not.toHaveBeenCalled();
    enabled=true;
    start(); idleTask();
    await vi.waitFor(()=>expect(preload).toHaveBeenCalledOnce());
  });

  it("waits for idle, then preloads Moonshine without Kokoro when English voices exist", async () => {
    let idleTask: (() => void) | undefined;
    const preload = vi.fn(async () => undefined);
    const start = createLocalSpeechBootstrap({
      schedule: (task) => {
        idleTask = task;
        return () => undefined;
      },
      hasEnglishBrowserVoice: async () => true,
      preload,
    });

    start();
    expect(preload).not.toHaveBeenCalled();
    idleTask?.();
    await vi.waitFor(() =>
      expect(preload).toHaveBeenCalledWith({ includeKokoro: false }),
    );
  });

  it("includes Kokoro when the browser cannot provide an English voice", async () => {
    let idleTask: (() => void) | undefined;
    const preload = vi.fn(async () => undefined);
    const start = createLocalSpeechBootstrap({
      schedule: (task) => {
        idleTask = task;
        return () => undefined;
      },
      hasEnglishBrowserVoice: async () => false,
      preload,
    });

    start();
    idleTask?.();
    await vi.waitFor(() =>
      expect(preload).toHaveBeenCalledWith({ includeKokoro: true }),
    );
  });

  it("is idempotent when startup is invoked more than once", () => {
    const schedule = vi.fn(() => () => undefined);
    const start = createLocalSpeechBootstrap({
      schedule,
      hasEnglishBrowserVoice: async () => false,
      preload: async () => undefined,
    });

    start();
    start();

    expect(schedule).toHaveBeenCalledOnce();
  });
});
