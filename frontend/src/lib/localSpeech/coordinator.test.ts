import { describe, expect, it, vi } from "vitest";
import { createLocalSpeechCoordinator } from "./coordinator";

describe("local speech model coordinator", () => {
  it("loads Moonshine before Kokoro and never downloads concurrently", async () => {
    const events: string[] = [];
    let finishMoonshine: () => void = () => undefined;
    const loadMoonshine = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          events.push("moonshine:start");
          finishMoonshine = () => {
            events.push("moonshine:end");
            resolve();
          };
        }),
    );
    const loadKokoro = vi.fn(async () => {
      events.push("kokoro:start");
    });
    const coordinator = createLocalSpeechCoordinator({
      capability: { eligible: true },
      loadMoonshine,
      loadKokoro,
    });

    const loading = coordinator.preload({ includeKokoro: true });
    await vi.waitFor(() => expect(loadMoonshine).toHaveBeenCalledOnce());
    expect(loadKokoro).not.toHaveBeenCalled();
    expect(coordinator.getState("moonshine")).toBe("loading");

    finishMoonshine();
    await loading;

    expect(events).toEqual([
      "moonshine:start",
      "moonshine:end",
      "kokoro:start",
    ]);
    expect(coordinator.getState("moonshine")).toBe("ready");
    expect(coordinator.getState("kokoro")).toBe("ready");
  });

  it("is idempotent across StrictMode-style duplicate preload calls", async () => {
    const loadMoonshine = vi.fn(async () => undefined);
    const loadKokoro = vi.fn(async () => undefined);
    const coordinator = createLocalSpeechCoordinator({
      capability: { eligible: true },
      loadMoonshine,
      loadKokoro,
    });

    await Promise.all([
      coordinator.preload({ includeKokoro: true }),
      coordinator.preload({ includeKokoro: true }),
    ]);

    expect(loadMoonshine).toHaveBeenCalledOnce();
    expect(loadKokoro).toHaveBeenCalledOnce();
  });

  it("marks models unavailable without invoking loaders on gated devices", async () => {
    const loadMoonshine = vi.fn(async () => undefined);
    const loadKokoro = vi.fn(async () => undefined);
    const coordinator = createLocalSpeechCoordinator({
      capability: { eligible: false, reason: "save-data" },
      loadMoonshine,
      loadKokoro,
    });

    await coordinator.preload({ includeKokoro: true });

    expect(loadMoonshine).not.toHaveBeenCalled();
    expect(loadKokoro).not.toHaveBeenCalled();
    expect(coordinator.getState("moonshine")).toBe("unavailable");
    expect(coordinator.getState("kokoro")).toBe("unavailable");
  });

  it("isolates a Moonshine failure and still attempts Kokoro", async () => {
    const coordinator = createLocalSpeechCoordinator({
      capability: { eligible: true },
      loadMoonshine: vi.fn(async () => {
        throw new Error("model fetch failed");
      }),
      loadKokoro: vi.fn(async () => undefined),
    });

    await coordinator.preload({ includeKokoro: true });

    expect(coordinator.getState("moonshine")).toBe("error");
    expect(coordinator.getState("kokoro")).toBe("ready");
  });
});
