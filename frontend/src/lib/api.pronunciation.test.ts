import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postPronunciation } from "./api";
import { setToken } from "./authToken";
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
