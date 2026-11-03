import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postPronunciation } from "./api";
import { setToken } from "./authToken";
import { bindInteraction } from "./telemetry";
import { MAX_AUDIO_BYTES } from "./audioLimits";
import * as timeout from "./requestTimeout";

const pcm = new ArrayBuffer(4);
beforeEach(() => setToken("pronunciation-api-a"));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("checks identity after constructing request options and before uploading", async () => {
  const original = timeout.withTimeout;
  vi.spyOn(timeout, "withTimeout").mockImplementation((signal, ms) => {
    setToken("pronunciation-api-b");
    return original(signal, ms);
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(postPronunciation("old text", pcm)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([true, false])("rejects stale pronunciation success/error responses (ok=%s)", async ok => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const pending = postPronunciation("old text", pcm);
  setToken("pronunciation-api-b"); setToken("pronunciation-api-a");
  resolve(new Response("{}", { status: ok ? 200 : 503 }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("checks identity after a delayed response body", async () => {
  let resolve!: (result: unknown) => void;
  const json = vi.fn(() => new Promise(r => { resolve = r; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));
  const pending = postPronunciation("old text", pcm);
  await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
  setToken("pronunciation-api-b");
  resolve({ overall: 91 });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("does not dispatch if its caller is already cancelled", async () => {
  const controller = new AbortController(); controller.abort();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(postPronunciation("old text", pcm, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).not.toHaveBeenCalled();
});
it("forwards the interaction and entry while rejecting oversized audio before upload", async () => {
  const controller = new AbortController();
  bindInteraction(controller.signal, "e".repeat(32));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await postPronunciation("text", pcm, controller.signal, "turn_correction");
  const [url, init] = vi.mocked(fetch).mock.calls[0]! as [string, RequestInit];
  expect(String(url)).toContain("entry=turn_correction");
  expect(init.headers).toMatchObject({ "X-Interaction-Id": "e".repeat(32) });

  vi.mocked(fetch).mockClear();
  await expect(postPronunciation("text", new ArrayBuffer(MAX_AUDIO_BYTES + 1), controller.signal)).rejects.toThrow("180 seconds");
  expect(fetch).not.toHaveBeenCalled();
});
