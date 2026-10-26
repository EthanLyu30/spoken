export async function readChatStream(
  response: Response,
  onText: (text: string) => void,
): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`chat stream failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = response.headers.get("content-type")?.includes("text/event-stream");
  let full = "";
  let buffer = "";
  let completed = false;
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
      onText(full);
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
        if (text) onText(full);
      }
      if (completed || done) break;
    }
    if (events && !completed) throw new Error("回复中断，请重试这一回合。");
    if (!full.trim()) throw new Error("empty stream");
    return full.trim();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
