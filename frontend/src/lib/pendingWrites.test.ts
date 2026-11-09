import { afterEach, expect, it, vi } from "vitest";
import { beginOwnerTransition, completeOwnerTransition, flushPendingWrites, postSession } from "./api";
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
