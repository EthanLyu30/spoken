import { afterEach, beforeEach, expect, it, vi } from "vitest";

const guestId = "legacy-browser-guest";
const payload = {
  scenario_id: "cafe",
  messages: [{ role: "user" as const, content: "A latte, please." }],
  overall: 81,
  summary: "",
  tip: "",
  scores: [],
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  localStorage.setItem("spoken-client-id", guestId);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each([
  ["an old backend without the capability route", 404],
  ["a compatible backend in mode zero", 200],
])("keeps a save guest-visible when registration loses its response on %s", async (_name, capabilityStatus) => {
  const { postSession, readGuestHistory } = await import("./api");
  const { useAuth } = await import("../store/auth");
  const { getToken } = await import("./authToken");
  let loseResponse!: (error: Error) => void;
  let registrationPosted!: () => void;
  const sent = new Promise<void>((resolve) => { registrationPosted = resolve; });
  const lostResponse = new Promise<Response>((_resolve, reject) => { loseResponse = reject; });
  const stored: Array<typeof payload & { id: number }> = [];
  const fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (path === "/api/auth/guest-capabilities") {
      return Response.json({ protocol: 0 }, { status: capabilityStatus });
    }
    if (path === "/api/auth/register") {
      expect(headers.has("X-Claim-Protocol")).toBe(false);
      registrationPosted();
      return lostResponse;
    }
    if (path === "/api/sessions" && init?.method === "POST") {
      expect(headers.get("X-Client-Id")).toBe(guestId);
      expect(headers.has("Authorization")).toBe(false);
      stored.push({ ...payload, id: 12 });
      return Response.json(stored[0], { status: 201 });
    }
    if (path === "/api/sessions" && headers.get("X-Client-Id") === guestId) {
      return Response.json(stored);
    }
    return Response.json([]);
  });
  vi.stubGlobal("fetch", fetcher);

  const registration = useAuth.getState().register("visitor@example.test", "test-password").catch((error: unknown) => error);
  await sent;
  const saving = postSession(payload).catch((error: unknown) => error);
  // The server may have created the account already. The browser cannot use
  // the absent response as authority to send this save with an account token.
  loseResponse(new TypeError("response lost"));

  await expect(registration).resolves.toEqual(new TypeError("response lost"));
  await expect(saving).resolves.toMatchObject({ id: 12 });
  expect(getToken()).toBeNull();
  expect(fetcher.mock.calls.filter(([path, init]) => path === "/api/sessions" && init?.method === "POST")).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem("spoken-owner-pending-writes") ?? "[]")).toEqual([]);
  const records = await readGuestHistory(guestId, new AbortController().signal);
  expect(records.sessions.map((record) => record.id)).toEqual([12]);
});
