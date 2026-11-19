import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomScene } from "../lib/api";
import { clearToken, setToken } from "../lib/authToken";
import { useSceneCues, type SceneCue } from "./useSceneCues";

const fresh = { revision: 0, cues: null };
const personal: SceneCue = { id: "saved", kind: "word", keyword: "decaf", meaning: "", sentence: "Decaf, please." };
const second: SceneCue = { id: "extra", kind: "pattern", keyword: "Is it iced?", meaning: "", sentence: "Is it iced?" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { clearToken(); vi.unstubAllGlobals(); });

it("keeps the published defaults usable while a read fails and honors an empty list on retry", async () => {
  const read = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(read.promise).mockResolvedValueOnce(json({ revision: 4, cues: [] })));
  const { result } = renderHook(() => useSceneCues("cafe"));
  expect(result.current.cues.map(cue => cue.keyword)).toEqual(["a latte", "oat milk", "pay by card"]);
  expect(result.current.cues[0]).toMatchObject({ id: "default-1", kind: "word" });
  expect(result.current.ready).toBe(false);
  await act(async () => { read.resolve(json({ detail: "Busy" }, 503)); });
  expect(result.current.error).toBeTruthy();
  expect(result.current.cues).toHaveLength(3);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.error).toBeNull();
  expect(result.current.cues).toEqual([]);
});

it("uses owner-aware per-item operations and keeps the newest revision when replies arrive out of order", async () => {
  const save = deferred<Response>();
  const hint = deferred<Response>();
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (!init.method || init.method === "GET") return json(fresh);
    const body = JSON.parse(String(init.body));
    requests.push({ url, body, headers: new Headers(init.headers) });
    if (body.action === "save") return save.promise;
    if (body.action === "add_hint") return hint.promise;
    return json({ detail: "Try again" }, 503);
  });
  const { result } = renderHook(() => useSceneCues("cafe"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const { id: _id, ...draft } = personal;
  const saving = result.current.save(draft);
  const adding = result.current.addHint(second.sentence);
  expect(requests[0].url).toBe("/api/scene-cues/cafe");
  expect(requests[0].body).toMatchObject({ action: "save", cue: draft });
  expect(requests[0].body.defaults).toHaveLength(3);
  expect(requests[0].headers.get("X-Claim-Protocol")).toBe("1");
  expect(requests[1].body).toMatchObject({ action: "add_hint", sentence: second.sentence });
  await act(async () => { hint.resolve(json({ revision: 2, cues: [personal, second] })); await adding; });
  await act(async () => { save.resolve(json({ revision: 1, cues: [personal] })); await saving; });
  expect(result.current.cues).toEqual([personal, second]);
  await expect(result.current.remove(personal.id)).rejects.toThrow("Try again");
  expect(requests[2].body).toMatchObject({ action: "remove", id: personal.id });
  expect(result.current.cues).toEqual([personal, second]);
});

it("rejects callbacks from the previous learner and discards late reads and writes from that account", async () => {
  const guestRead = deferred<Response>();
  const guestWrite = deferred<Response>();
  const fetcher = vi.fn((_url: string, init: RequestInit) => {
    if (new Headers(init.headers).has("Authorization")) return Promise.resolve(json({ revision: 1, cues: [] }));
    return init.method === "PATCH" ? guestWrite.promise : guestRead.promise;
  });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useSceneCues("cafe"));
  const previousAdd = result.current.addHint;
  const writing = previousAdd(personal.sentence);
  act(() => setToken("signed-in-account"));
  await waitFor(() => expect(result.current.ready).toBe(true));
  const count = fetcher.mock.calls.length;
  await expect(previousAdd("Wrong owner")).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(count);
  await act(async () => {
    guestRead.resolve(json({ revision: 8, cues: [personal] }));
    guestWrite.resolve(json({ revision: 9, cues: [personal, second] }));
    await expect(writing).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(result.current.cues).toEqual([]);
});

it("keeps an in-flight change tied to the full custom scene even when the next lesson shares its title", async () => {
  const scene: CustomScene = { title: "Booking", title_zh: "订房", partner_role: "receptionist", persona: "You work at a hotel.",
    opening_line: "For how many nights?", goal: "Book a room.", practice_cues: [{ keyword: "nights", meaning: "晚", sentence: "Two nights." }] };
  const later = deferred<Response>();
  const calls: { url: string; custom: CustomScene }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const { custom } = JSON.parse(String(init.body));
    calls.push({ url, custom });
    if (init.method === "PATCH") return later.promise;
    return json(custom.goal === "Book a room." ? fresh : { revision: 3, cues: [second] });
  });
  const { result, rerender } = renderHook(({ custom }) => useSceneCues("custom", custom), { initialProps: { custom: scene } });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.cues[0].keyword).toBe("nights");
  const saving = result.current.addHint("I will check out early.");
  rerender({ custom: { ...scene, goal: "Change a booking." } });
  await waitFor(() => expect(result.current.cues).toEqual([second]));
  await act(async () => {
    later.resolve(json({ revision: 4, cues: [personal] }));
    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(calls[0]).toMatchObject({ url: "/api/scene-cues/custom/lookup", custom: scene });
  expect(calls[1]).toMatchObject({ url: "/api/scene-cues/custom", custom: scene });
  expect(result.current.cues).toEqual([second]);
});

it("shows an error for an invalid successful response and leaves the built-in cues available", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));
  const { result } = renderHook(() => useSceneCues("airport"));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.ready).toBe(false);
  expect(result.current.cues[0].keyword).toBe("check in");
});

it("delivers a completed save to the next mounted view of the same scene", async () => {
  const scene: CustomScene = { title: "Directions", title_zh: "问路", partner_role: "passerby",
    goal: "Find the station.", persona: "You live nearby.", opening_line: "Can I help you?" };
  const write = deferred<Response>();
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => init.method === "PATCH"
    ? write.promise : Promise.resolve(json(fresh)));
  const conversation = renderHook(() => useSceneCues("custom", scene));
  await waitFor(() => expect(conversation.result.current.ready).toBe(true));
  const saving = conversation.result.current.addHint(personal.sentence);
  conversation.unmount();
  // A saved conversation can rehydrate optional fields and a different display label.
  const prep = renderHook(() => useSceneCues("custom", { ...scene, source: "练习记录", practice_cues: [] }));
  await waitFor(() => expect(prep.result.current.ready).toBe(true));
  await act(async () => {
    write.resolve(json({ revision: 1, cues: [personal] }));
    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(prep.result.current.cues).toEqual([personal]);
});
