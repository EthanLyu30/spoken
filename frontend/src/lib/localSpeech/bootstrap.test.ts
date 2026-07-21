import { describe, expect, it, vi } from "vitest";
import { createLocalSpeechBootstrap } from "./bootstrap";

describe("local speech bootstrap", () => {
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
