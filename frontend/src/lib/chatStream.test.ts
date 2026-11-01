import { afterEach, describe, expect, it, vi } from "vitest";
import { readChatStream } from "./chatStream";

function response(parts: string[], type = "text/event-stream") {
  const encoded = new TextEncoder().encode(parts.join(""));
  // Split inside UTF-8 characters and event boundaries.
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3));
    controller.close();
  } }), { headers: { "Content-Type": type } });
}

describe("chat stream completion", () => {
  it("assembles UTF-8 deltas only after an explicit completion event", async () => {
    const seen: string[] = [];
    const result = await readChatStream(response([
      'event: delta\r\ndata: {"text":"Hello, "}\r\n\r\n',
      'event: delta\ndata: {"text":"你好!"}\n\n',
      'event: done\ndata: {}\n\n',
    ]), (text) => seen.push(text));
    expect(result).toBe("Hello, 你好!");
    expect(seen).toEqual(["Hello, ", "Hello, 你好!"]);
  });

  it("rejects a partial reply without a completion event", async () => {
    await expect(readChatStream(response(['event: delta\ndata: {"text":"Half a reply"}\n\n']), () => {})).rejects.toThrow(/中断/);
  });

  it("rejects an explicit upstream failure after receiving text", async () => {
    await expect(readChatStream(response([
      'event: delta\ndata: {"text":"Half"}\n\n',
      'event: error\ndata: {"message":"Please retry"}\n\n',
    ]), () => {})).rejects.toThrow("Please retry");
  });

  it("supports the old plain-text backend during rolling deployment", async () => {
    expect(await readChatStream(response(["Hello there!"], "text/plain"), () => {})).toBe("Hello there!");
  });
});


it("returns accepted text and releases the lock while transport cancellation is still pending", async () => {
  let release!: () => void;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"Complete"}\n\nevent: done\ndata: {}\n\n')); },
    cancel() { cancelled = true; return new Promise<void>(resolve => { release = resolve; }); },
  });
  let accepted: string | undefined;
  const result = readChatStream(new Response(body, { headers: { "Content-Type": "text/event-stream" } }), () => {}).then(text => { accepted = text; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  try { expect(cancelled).toBe(true); expect(accepted).toBe("Complete"); expect(body.locked).toBe(false); }
  finally { release(); await result; }
});


afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("measures first text, accepted completion and tail with an opaque interaction only", async () => {
  const samples: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { samples.push(JSON.parse(String(init.body))); return new Response(null, {status: 202}); });
  let now = 20; vi.spyOn(performance, "now").mockImplementation(() => now);
  const body = new ReadableStream<Uint8Array>({start(controller) {
    controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"Private text"}\n\n'));
    controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
  }});
  expect(await readChatStream(new Response(body, {headers: {"Content-Type":"text/event-stream"}}), () => { now = 50; }, {requestedAt: 10, interactionId: "b".repeat(32)})).toBe("Private text");
  expect(samples).toEqual([
    expect.objectContaining({operation:"chat.first_text", duration_ms:10, interaction_id:"b".repeat(32)}),
    expect.objectContaining({operation:"chat.complete", duration_ms:40, interaction_id:"b".repeat(32)}),
    expect.objectContaining({operation:"chat.tail", duration_ms:30, interaction_id:"b".repeat(32)}),
  ]);
  expect(JSON.stringify(samples)).not.toContain("Private");
});
it.each(["reject", "throw"])("preserves the original stream failure if cancellation cleanup will %s", async cleanup => {
  const original = new DOMException("Original abort", "AbortError");
  const body = new ReadableStream<Uint8Array>({pull() { throw original; }});
  const res = new Response(body);
  const reader = body.getReader();
  vi.spyOn(body, "getReader").mockReturnValue(reader);
  vi.spyOn(reader, "cancel").mockImplementation(() => { if (cleanup === "throw") throw new Error("cleanup"); return Promise.reject(new Error("cleanup")); });
  await expect(readChatStream(res, () => {})).rejects.toBe(original);
  expect(body.locked).toBe(false);
});


it("includes synchronous cancellation initiation in accepted-return timing", async () => {
  const samples: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { samples.push(JSON.parse(String(init.body))); return new Response(null,{status:202}); });
  let now=20;vi.spyOn(performance,"now").mockImplementation(()=>now);
  const body=new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"Complete"}\n\nevent: done\ndata: {}\n\n')); },
    cancel() { now=40; },
  });
  await readChatStream(new Response(body,{headers:{"Content-Type":"text/event-stream"}}),()=>{},{requestedAt:10});
  expect(samples).toContainEqual(expect.objectContaining({operation:"chat.complete",duration_ms:30}));
});
