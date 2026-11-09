import { afterEach, expect, it, vi } from "vitest";
import { beginOwnerTransition, endOwnerTransition, flushPendingWrites, postSession } from "./api";

const payload = {
  scenario_id: "cafe",
  messages: [{ role: "user" as const, content: "A latte, please." }],
  overall: 80,
  summary: "",
  tip: "",
  scores: [],
};

afterEach(() => {
  endOwnerTransition();
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

  endOwnerTransition();
  await save;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("waits for a registration transition started in another tab", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 43 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  localStorage.setItem("spoken-owner-transition", JSON.stringify({ id: "other-tab", startedAt: Date.now() }));

  const save = postSession({ ...payload });
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();

  localStorage.removeItem("spoken-owner-transition");
  window.dispatchEvent(new StorageEvent("storage", { key: "spoken-owner-transition", newValue: null }));
  await save;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
