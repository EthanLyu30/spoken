import { afterEach, describe, expect, it, vi } from "vitest";
import { getGuestClaimCapability, registerUser } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>) {
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => impl());
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("guest claim capability", () => {
  it("carries the same registration and authorization from discovery to the register request", async () => {
    const fetcher = stubFetch(async () => Response.json({ protocol: 1, ticket: "server-ticket" }));
    const capability = await getGuestClaimCapability("registration-1");
    expect(capability).toEqual({ transitionId: "registration-1", ticket: "server-ticket" });
    const discovery = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(discovery.get("X-Claim-Transition")).toBe("registration-1");
    expect(fetcher.mock.calls[0][1]?.cache).toBe("no-store");

    await registerUser("visitor@example.test", "secret-password", undefined, capability);
    const registration = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(registration.get("X-Claim-Protocol")).toBe("1");
    expect(registration.get("X-Claim-Transition")).toBe("registration-1");
    expect(registration.get("X-Claim-Ticket")).toBe("server-ticket");
  });

  it("keeps writes in guest scope if the advertised protocol has no authorization", async () => {
    stubFetch(async () => Response.json({ protocol: 1 }));
    await expect(getGuestClaimCapability("registration-1")).resolves.toBeNull();
  });

  it("falls back to legacy on an old backend 404", async () => {
    stubFetch(async () => new Response("not found", { status: 404 }));
    await expect(getGuestClaimCapability("registration-1")).resolves.toBeNull();
  });

  it("falls back to legacy on a network timeout", async () => {
    stubFetch(async () => {
      throw new TypeError("network timeout");
    });
    await expect(getGuestClaimCapability("registration-1")).resolves.toBeNull();
  });

  it("never upgrades an unknown protocol value", async () => {
    stubFetch(async () =>
      Response.json({ protocol: 2, ticket: "unrecognized" }),
    );
    await expect(getGuestClaimCapability("registration-1")).resolves.toBeNull();
  });
});
