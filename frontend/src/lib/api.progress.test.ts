import { afterEach, expect, it, vi } from "vitest";
import { getStats, deleteWord } from "./api";
import { progressGeneration } from "./progressCache";
import { setToken, clearToken } from "./authToken";
afterEach(() => { vi.unstubAllGlobals(); clearToken(); });
it("sends a device timezone and invalidates progress after deletion", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});
  vi.stubGlobal("fetch", fetcher);
  await getStats();
  expect(fetcher.mock.calls[0][1].headers["X-Timezone"]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const before = progressGeneration();
  await deleteWord(1);
  expect(progressGeneration()).toBe(before + 1);
});
it("rejects a response from a previous account", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolve = r; })));
  setToken("old");
  const pending = getStats();
  setToken("new");
  resolve({ok:true,json:async()=>({today_count:1})});
  await expect(pending).rejects.toThrow();
});

it("falls back to UTC when the device timezone cannot be resolved", async () => {
  const formatter = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => { throw new Error("unavailable"); });
  const fetcher = vi.fn().mockResolvedValue({ok:true,json:async()=>({})});
  vi.stubGlobal("fetch", fetcher);
  await getStats();
  expect(fetcher.mock.calls[0][1].headers["X-Timezone"]).toBe("UTC");
  formatter.mockRestore();
});
it("rejects a stale unauthorized response before exposing its status", async () => {
  let resolve!: (value: unknown) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(r => { resolve = r; })));
  setToken("old");
  const pending = getStats();
  setToken("new");
  resolve({ok:false,status:401,json:async()=>({detail:"expired"})});
  await expect(pending).rejects.toMatchObject({name:"AbortError"});
});

it("does not dispatch an old request if identity changes while constructing headers", async () => {
  const client = await import("./clientId");
  const spy = vi.spyOn(client, "getClientId").mockImplementation(() => { setToken("new"); return "device"; });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  setToken("old");
  await expect(getStats()).rejects.toMatchObject({name:"AbortError"});
  expect(fetcher).not.toHaveBeenCalled();
  spy.mockRestore();
});
