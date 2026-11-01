import { reportTiming } from "./telemetry";

export async function readChatStream(
  response: Response,
  onText: (text: string) => void,
  timing?: {requestedAt: number; interactionId?: string},
): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`chat stream failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = response.headers.get("content-type")?.includes("text/event-stream");
  let full = "";
  let buffer = "";
  let completed = false;
  let lastTextAt: number | undefined;
  const deliver = () => {
    const now = performance.now();
    if (timing && lastTextAt === undefined) reportTiming("chat.first_text", now - timing.requestedAt, {interactionId: timing.interactionId});
    lastTextAt = now;
    onText(full);
  };
  const parse = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (event === "done") { completed = true; return; }
    const value = JSON.parse(data) as { text?: string; message?: string };
    if (event === "error") throw new Error(value.message || "回复中断，请重试。");
    if (event === "delta" && typeof value.text === "string") {
      full += value.text;
      deliver();
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (events) {
        buffer += text;
        let boundary: RegExpExecArray | null;
        while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
          parse(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (completed) break;
        }
      } else {
        full += text;
        if (text) deliver();
      }
      if (completed || done) break;
    }
    if (events && !completed) throw new Error("回复中断，请重试这一回合。");
    if (!full.trim()) throw new Error("empty stream");
  } finally {
    // Cancellation may wait for transport shutdown indefinitely. Initiate it,
    // observe rejection, and release our lock without delaying text or errors.
    try { void reader.cancel().catch(() => undefined); } catch { /* cleanup is best effort */ }
    try { reader.releaseLock(); } catch { /* preserve the original stream result */ }
  }
  if (timing) {
    const now = performance.now();
    reportTiming("chat.complete", now - timing.requestedAt, {interactionId: timing.interactionId});
    if (lastTextAt !== undefined) reportTiming("chat.tail", now - lastTextAt, {interactionId: timing.interactionId});
  }
  return full.trim();

}
