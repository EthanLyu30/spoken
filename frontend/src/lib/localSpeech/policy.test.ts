import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessLocalSpeechCapability,
  scheduleLocalSpeechPreload,
} from "./policy";

describe("local speech capability policy", () => {
  it("allows capable browsers when optional hardware hints are absent", () => {
    expect(
      assessLocalSpeechCapability({
        worker: true,
        cacheStorage: true,
      }),
    ).toEqual({ eligible: true });
  });

  it("does not background-download on data saver or very low-memory devices", () => {
    expect(
      assessLocalSpeechCapability({
        worker: true,
        cacheStorage: true,
        saveData: true,
      }),
    ).toEqual({ eligible: false, reason: "save-data" });
    expect(
      assessLocalSpeechCapability({
        worker: true,
        cacheStorage: true,
        deviceMemory: 2,
      }),
    ).toEqual({ eligible: false, reason: "low-memory" });
    expect(
      assessLocalSpeechCapability({
        worker: true,
        cacheStorage: true,
        hardwareConcurrency: 2,
      }),
    ).toEqual({ eligible: false, reason: "low-cpu" });
  });

  it("requires workers and persistent browser cache for background models", () => {
    expect(
      assessLocalSpeechCapability({ worker: false, cacheStorage: true }),
    ).toEqual({ eligible: false, reason: "no-worker" });
    expect(
      assessLocalSpeechCapability({ worker: true, cacheStorage: false }),
    ).toEqual({ eligible: false, reason: "no-cache" });
  });
});

describe("local speech idle scheduling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses requestIdleCallback when available", () => {
    const task = vi.fn();
    const cancelIdleCallback = vi.fn();
    let idleCallback: IdleRequestCallback | undefined;
    const cancel = scheduleLocalSpeechPreload(task, {
      requestIdleCallback: (callback) => {
        idleCallback = callback;
        return 7;
      },
      cancelIdleCallback,
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });

    expect(task).not.toHaveBeenCalled();
    idleCallback?.({ didTimeout: false, timeRemaining: () => 20 });
    expect(task).toHaveBeenCalledOnce();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to a short timer", () => {
    vi.useFakeTimers();
    const task = vi.fn();
    scheduleLocalSpeechPreload(task, {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    });

    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    expect(task).toHaveBeenCalledOnce();
  });
});
