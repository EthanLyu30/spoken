import { afterEach, expect, it, vi } from "vitest";
import { beginOwnerTransition, completeOwnerTransition, flushPendingWrites, postSession, retryPendingOwnerWrites } from "./api";
import { clearToken, setToken } from "./authToken";

function accountToken(id: number): string {
  return `header.${btoa(JSON.stringify({ sub: String(id) }))}.signature`;
}

const payload = {
  scenario_id: "cafe",
  messages: [{ role: "user" as const, content: "A latte, please." }],
  overall: 80,
  summary: "",
  tip: "",
  scores: [],
};

afterEach(() => {
  completeOwnerTransition("failed");
  clearToken();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("waits for an in-flight guest save before registration can switch identity", async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal("fetch", fetchMock);

  const save = postSession({ ...payload });

  let flushed = false;
  const flush = flushPendingWrites().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  expect(flushed).toBe(false);

  release(
    new Response(JSON.stringify({ id: 41 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await save;
  await flush;
  expect(flushed).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("fails the flush when a tracked guest save fails, so registration can abort", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "save unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  const save = postSession({ ...payload });
  const handled = save.catch((error) => error);

  await expect(flushPendingWrites()).rejects.toThrow("save unavailable");
  await handled;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("queues a save that starts after registration begins until identity is decided", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 42 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  beginOwnerTransition();
  const save = postSession({ ...payload });
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();

  setToken(accountToken(7));
  completeOwnerTransition("success", 7);
  await save;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("waits for a registration transition started in another tab", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 43 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("spoken-client-id", "guest-other-tab");
  localStorage.setItem("spoken-owner-transition", JSON.stringify({
    id: "other-tab", guestId: "guest-other-tab", startedAt: Date.now(),
  }));

  const save = postSession({ ...payload });
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();

  setToken(accountToken(8));
  const outcome = JSON.stringify({ id: "other-tab", status: "success", targetUserId: 8 });
  localStorage.setItem("spoken-owner-transition-outcome", outcome);
  window.dispatchEvent(new StorageEvent("storage", {
    key: "spoken-owner-transition-outcome", newValue: outcome,
  }));
  await save;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


it("does not send a queued save through an unrelated account token", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 44 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  beginOwnerTransition();
  const save = postSession({ ...payload });
  await Promise.resolve();

  setToken(accountToken(9));
  completeOwnerTransition("success", 7);
  await expect(save).rejects.toThrow("当前登录账号不是该注册记录的目标账号");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps a queued save when the registration outcome is unknown", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  beginOwnerTransition();
  const save = postSession({ ...payload });
  await Promise.resolve();

  completeOwnerTransition("unknown", undefined, "response lost");
  await expect(save).rejects.toThrow("response lost");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("rejects a second registration transition in the same tab", () => {
  beginOwnerTransition();
  expect(() => beginOwnerTransition()).toThrow("正在进行");
  completeOwnerTransition("failed");
});


it("retains a failed save for a later registration flush", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "save unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const save = postSession({ ...payload }).catch((error) => error);
  await save;
  await expect(flushPendingWrites()).rejects.toThrow("save unavailable");
});


it("keeps an existing account write out of a guest registration transition", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 45 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  beginOwnerTransition();
  setToken(accountToken(2));

  await postSession({ ...payload });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
  expect(headers.Authorization).toBe(`Bearer ${accountToken(2)}`);
  completeOwnerTransition("failed");
});

it("clears a stale transition marker before starting a new registration", () => {
  localStorage.setItem("spoken-owner-transition", JSON.stringify({
    id: "stale", guestId: "guest-stale", startedAt: Date.now() - 24 * 60 * 60 * 1000,
  }));
  const transition = beginOwnerTransition();
  expect(transition.id).not.toBe("stale");
  expect(JSON.parse(localStorage.getItem("spoken-owner-transition")!).id).toBe(transition.id);
  completeOwnerTransition("failed");
});

it("merges queued writes instead of replacing another module's record", async () => {
  const old = {
    id: "old-record", transitionId: "old-transition", guestId: "guest-old",
    path: "/api/sessions", method: "POST", body: "{}", headers: {}, createdAt: Date.now(),
  };
  localStorage.setItem("spoken-owner-pending-writes", JSON.stringify([old]));
  beginOwnerTransition();
  const save = postSession({ ...payload }).catch(() => undefined);
  await Promise.resolve();

  const rows = JSON.parse(localStorage.getItem("spoken-owner-pending-writes")!) as Array<{ id: string }>;
  expect(rows.some((row) => row.id === "old-record")).toBe(true);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  completeOwnerTransition("failed");
  await save;
});

it("sends the same queued record only once when retries race", async () => {
  const token = accountToken(3);
  const record = {
    id: "one-record", transitionId: "one-transition", guestId: "guest-one",
    path: "/api/sessions", method: "POST", body: JSON.stringify(payload),
    headers: {}, createdAt: Date.now(),
  };
  localStorage.setItem("spoken-owner-pending-writes", JSON.stringify([record]));
  localStorage.setItem("spoken-owner-transition-outcome", JSON.stringify({
    id: "one-transition", status: "success", targetUserId: 3,
  }));
  setToken(token);
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 46 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await Promise.all([retryPendingOwnerWrites(), retryPendingOwnerWrites()]);
  const saves = fetchMock.mock.calls.filter(([url, init]) =>
    String(url).endsWith("/api/sessions") && init?.method === "POST");
  expect(saves).toHaveLength(1);
});


it("does not let a different guest adopt another guest's registration", async () => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ id: 47 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("spoken-client-id", "guest-B");
  localStorage.setItem("spoken-owner-transition", JSON.stringify({
    id: "guest-A-transition", guestId: "guest-A", startedAt: Date.now(),
  }));

  await postSession({ ...payload });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
  expect(headers["X-Client-Id"]).toBe("guest-B");
});

it("does not let an old registration completion clear a newer marker", () => {
  const old = beginOwnerTransition();
  localStorage.setItem("spoken-owner-transition", JSON.stringify({
    id: "newer", guestId: "guest-newer", startedAt: Date.now(),
  }));
  completeOwnerTransition("success", 5, undefined, old.id);
  expect(JSON.parse(localStorage.getItem("spoken-owner-transition")!).id).toBe("newer");
  completeOwnerTransition("failed");
});

it("does not resurrect a record removed by another module", async () => {
  beginOwnerTransition();
  const save = postSession({ ...payload }).catch(() => undefined);
  await Promise.resolve();
  const before = JSON.parse(localStorage.getItem("spoken-owner-pending-writes")!) as Array<{ id: string }>;
  const oldId = before[before.length - 1].id;
  // Simulate another tab confirming and removing that record.
  localStorage.setItem("spoken-owner-pending-writes", JSON.stringify(before.filter((row) => row.id !== oldId)));

  const save2 = postSession({ ...payload }).catch(() => undefined);
  await Promise.resolve();
  const after = JSON.parse(localStorage.getItem("spoken-owner-pending-writes")!) as Array<{ id: string }>;
  expect(after.some((row) => row.id === oldId)).toBe(false);
  completeOwnerTransition("failed");
  await Promise.all([save, save2]);
});

it("retains a late 409 guest-claimed write for claim recovery", async () => {
  localStorage.setItem("spoken-client-id", "guest-late");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "guest_data_claimed" }), {
    status: 409,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(postSession({ ...payload })).rejects.toThrow("guest_data_claimed");
  const queued = JSON.parse(localStorage.getItem("spoken-owner-pending-writes")!) as Array<{ id: string; guestId: string }>;
  expect(queued.some((row) => row.guestId === "guest-late")).toBe(true);
});
