import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {prepareCloudSpeech} from "./cloudSpeechPreparation";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("takes a ready one-use ticket without sending text or credentials", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ticket:"a".repeat(32)}));
  vi.stubGlobal("fetch", fetcher);
  const preparation = prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  expect(preparation.take()).toBe("a".repeat(32));
  expect(preparation.take()).toBeUndefined();
  expect(fetcher).toHaveBeenCalledWith("/api/tts/prepare", expect.objectContaining({method:"POST"}));
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
  expect(fetcher.mock.calls[0][1]).not.toHaveProperty("headers");
  expect(vi.getTimerCount()).toBe(0);
});

it("never waits for a pending preparation and ignores its late ticket", async () => {
  let resolve:(response:Response)=>void=()=>{};
  vi.stubGlobal("fetch", () => new Promise<Response>(done=>{resolve=done;}));
  const preparation = prepareCloudSpeech();
  expect(preparation.take()).toBeUndefined();
  resolve(Response.json({ticket:"a".repeat(32)}));
  await vi.advanceTimersByTimeAsync(0);
  expect(preparation.take()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([404,429,503])("leaves ordinary speech usable when prepare returns %s", async status => {
  vi.stubGlobal("fetch", async () => new Response(null,{status}));
  const preparation = prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  expect(preparation.take()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["bad", "A".repeat(32), "a".repeat(33)])("rejects malformed tickets", async ticket => {
  vi.stubGlobal("fetch", async()=>Response.json({ticket}));
  const preparation=prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  expect(preparation.take()).toBeUndefined();
});

it("cancels a hung preparation at 1500 ms without an unhandled rejection", async () => {
  let signal:AbortSignal|undefined;
  vi.stubGlobal("fetch", (_:string,init:RequestInit) => {
    signal=init.signal!;
    return new Promise<Response>((_,reject)=>signal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));
  });
  const preparation=prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(1500);
  expect(signal?.aborted).toBe(true);
  expect(preparation.take()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("invalidates ready tickets when their owner is aborted or disposed", async () => {
  vi.stubGlobal("fetch", async()=>Response.json({ticket:"b".repeat(32)}));
  const parent=new AbortController();
  const preparation=prepareCloudSpeech(parent.signal);
  await vi.advanceTimersByTimeAsync(0);
  parent.abort();
  expect(preparation.take()).toBeUndefined();
  const other=prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  other.dispose();
  expect(other.take()).toBeUndefined();
  const cancelled=prepareCloudSpeech(parent.signal);
  expect(cancelled.take()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("absorbs synchronous fetch errors and invalid JSON", async () => {
  vi.stubGlobal("fetch", ()=>{throw new Error("offline");});
  const failed=prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  expect(failed.take()).toBeUndefined();
  vi.stubGlobal("fetch", async()=>new Response("invalid json"));
  const malformed=prepareCloudSpeech();
  await vi.advanceTimersByTimeAsync(0);
  expect(malformed.take()).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

it("attaches a prepared ticket to the original complete audio request", async () => {
  const BrowserURL=URL;
  vi.stubGlobal("URL",class extends BrowserURL { static createObjectURL() { return "blob:complete-audio"; } });
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(new Uint8Array([1,0,2,0]),{headers:{"Content-Type":"audio/wav"}}));
  vi.stubGlobal("fetch",fetcher);
  const {fetchTtsUrl}=await import("./api");
  await expect(fetchTtsUrl("The full reply.","cafe",undefined,{vcn:"henry",speed:42,pitch:61},"f".repeat(32))).resolves.toBe("blob:complete-audio");
  expect(fetcher.mock.calls[0][0]).toBe("/api/tts");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({text:"The full reply.",scenario_id:"cafe",vcn:"henry",speed:42,pitch:61,warmup_ticket:"f".repeat(32)});
});
