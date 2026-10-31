import { describe, expect, it, vi } from "vitest";
import { createLocalSpeechBootstrap } from "./bootstrap";
import { createLocalSpeechCoordinator } from "./coordinator";

describe("local speech bootstrap", () => {
  it("resumes recognition preparation when re-enabled after pronunciation finished while disabled",async()=>{
    let enabled=true;
    let finishPronunciation=()=>{};
    const tasks:Array<()=>void>=[];
    const recognition=vi.fn(async()=>{});
    const coordinator=createLocalSpeechCoordinator({
      capability:{eligible:true},loadMoonshine:recognition,
      loadKokoro:()=>new Promise<void>(resolve=>{finishPronunciation=resolve;}),
    });
    const start=createLocalSpeechBootstrap({enabled:()=>enabled,
      schedule:task=>{tasks.push(task);return()=>{};},hasEnglishBrowserVoice:async()=>false,
      priority:"kokoro",preload:options=>coordinator.preload({...options,shouldContinue:()=>enabled}),
    });
    start();tasks[0]();
    await vi.waitFor(()=>expect(coordinator.getState("kokoro")).toBe("loading"));
    enabled=false;finishPronunciation();
    await vi.waitFor(()=>expect(coordinator.getState("kokoro")).toBe("ready"));
    expect(recognition).not.toHaveBeenCalled();
    enabled=true;start();
    expect(tasks).toHaveLength(2);
    tasks[1]();
    await vi.waitFor(()=>expect(coordinator.getState("moonshine")).toBe("ready"));
    expect(recognition).toHaveBeenCalledOnce();
  });

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
