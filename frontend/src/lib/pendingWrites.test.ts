import { afterEach, expect, it, vi } from "vitest";
import { flushPendingWrites, postSession } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("waits for an in-flight guest save before registration can switch identity", async () => {
  let release!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const fetchMock = vi.fn(() => response);
  vi.stubGlobal("fetch", fetchMock);

  const save = postSession({
    scenario_id: "cafe",
    messages: [{ role: "user", content: "A latte, please." }],
    overall: 80,
    summary: "",
    tip: "",
    scores: [],
  });

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
