import { afterEach, describe, expect, it, vi } from "vitest";
import { getGuestClaimCapability } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("guest claim capability", () => {
  it("uses protocol 1 only when the backend advertises it", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ protocol: 1 }), { status: 200 }),
    );
    await expect(getGuestClaimCapability()).resolves.toBe(1);
  });

  it("falls back to legacy on an old backend 404", async () => {
    stubFetch(async () => new Response("not found", { status: 404 }));
    await expect(getGuestClaimCapability()).resolves.toBe(0);
  });

  it("falls back to legacy on a network timeout", async () => {
    stubFetch(async () => {
      throw new TypeError("network timeout");
    });
    await expect(getGuestClaimCapability()).resolves.toBe(0);
  });

  it("never upgrades an unknown protocol value", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ protocol: 2 }), { status: 200 }),
    );
    await expect(getGuestClaimCapability()).resolves.toBe(0);
  });
});
