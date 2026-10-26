import { describe, expect, it } from "vitest";
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
