import { describe, expect, it, vi } from "vitest";
import { createLocalSpeechCoordinator } from "./coordinator";

describe("local speech model coordinator", () => {
  it("publishes stable snapshots with per-file downloaded bytes and independent readiness", async () => {
    let progress: (event: unknown) => void = () => {};
    let finish: () => void = () => {};
    const coordinator = createLocalSpeechCoordinator({
      capability: { eligible: true },
      loadMoonshine: async () => { throw new Error("recognition failed"); },
      loadKokoro: (report) => new Promise<void>(resolve => { progress=report; finish=resolve; }),
    });
    const changed=vi.fn();
    const initial=coordinator.getSnapshot();
    expect(coordinator.getSnapshot()).toBe(initial);
    const unsubscribe=coordinator.subscribe(changed);
    const loading=coordinator.preload({ includeKokoro:true, priority:"kokoro" });
    await vi.waitFor(()=>expect(coordinator.getState("kokoro")).toBe("loading"));
    progress({status:"progress",file:"a.onnx",loaded:1024});
    progress({status:"progress",file:"b.onnx",loaded:2048});
    progress({status:"progress",file:"a.onnx",loaded:2048});
    expect(coordinator.getSnapshot().kokoro.downloadedBytes).toBe(4096);
    expect(changed).toHaveBeenCalled();
    finish();
    await loading;
    expect(coordinator.getSnapshot().kokoro.state).toBe("ready");
    expect(coordinator.getSnapshot().moonshine.state).toBe("error");
    unsubscribe();
  });

  it("retries a failed load rather than reusing the rejected attempt", async () => {
    const loadKokoro=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    const coordinator=createLocalSpeechCoordinator({capability:{eligible:true}, loadKokoro, loadMoonshine:async()=>{}});
    await coordinator.preload({includeKokoro:true,priority:"kokoro"});
    expect(coordinator.getState("kokoro")).toBe("error");
    await coordinator.preload({includeKokoro:true,priority:"kokoro"});
    expect(loadKokoro).toHaveBeenCalledTimes(2);
    expect(coordinator.getState("kokoro")).toBe("ready");
    coordinator.markError("kokoro",new Error("inference timed out"));
    expect(coordinator.getState("kokoro")).toBe("error");
  });

  it("prioritizes pronunciation and skips the next download after local mode is disabled", async () => {
    let enabled=true;
    const events:string[]=[];
    const coordinator=createLocalSpeechCoordinator({
      capability:{eligible:true},
      loadKokoro:async()=>{events.push("kokoro");enabled=false;},
      loadMoonshine:async()=>{events.push("moonshine");},
    });
    await coordinator.preload({includeKokoro:true,priority:"kokoro",shouldContinue:()=>enabled});
    expect(events).toEqual(["kokoro"]);
  });

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
