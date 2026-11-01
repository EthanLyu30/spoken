import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../lib/recorder", () => ({ startRecording: vi.fn() }));
import { startRecording } from "../lib/recorder";
import { PronounceButton } from "./PronounceButton";
import { setToken } from "../lib/authToken";
class Socket {
  static OPEN = 1; static instances: Socket[] = []; readyState = 0; bufferedAmount = 0; binaryType = ""; sent: (string | ArrayBuffer)[] = [];
  onopen: (() => void) | null = null; onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null; onclose: (() => void) | null = null;
  constructor(_url: string) { Socket.instances.push(this); }
  send(value: string | ArrayBuffer) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
const score = { overall: 91, accuracy: 92, fluency: 93, integrity: 94, standard: 95, words: [] };
let emit: ((pcm: ArrayBuffer) => void) | undefined, captureSignal: AbortSignal | undefined;
let stop: ReturnType<typeof vi.fn>, fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); setToken("pronunciation-stream-owner"); Socket.instances = []; vi.stubGlobal("WebSocket", Socket);
  stop = vi.fn().mockResolvedValue(new ArrayBuffer(1280)); emit = undefined; captureSignal = undefined;
  vi.mocked(startRecording).mockReset().mockImplementation(async (onPcm, signal) => { emit = onPcm; captureSignal = signal; return { stop }; });
  fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/api/pronunciation") ? score : { id: 1 })));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function begin() { const view = render(<PronounceButton text="Read the original line" />); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "跟读评分" })); }); return view; }
async function ready() {
  const view = await begin(); act(() => emit?.(new ArrayBuffer(1280)));
  expect(Socket.instances).toHaveLength(1); const socket = Socket.instances[0]; act(() => { socket.open(); socket.message({ type: "ready" }); }); return { view, socket };
}
const assessmentPosts = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/api/pronunciation"));
it("uploads while the microphone is recording and saves one streamed result", async () => {
  const { socket } = await ready(); expect(stop).not.toHaveBeenCalled();
  expect(socket.sent.some(value => value instanceof ArrayBuffer)).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "停止评分" })); });
  act(() => socket.message({ type: "result", result: score })); await act(async () => { });
  expect(screen.getByText("91")).toBeVisible(); expect(assessmentPosts()).toHaveLength(0);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/api/practice"))).toHaveLength(1);
});
it.each(["error", "timeout", "unsupported"])("uses one complete buffered assessment if startup never becomes ready: %s", async failure => {
  if (failure === "unsupported") vi.stubGlobal("WebSocket", class { constructor() { throw new Error("unsupported"); } });
  await begin(); act(() => emit?.(new ArrayBuffer(1280)));
  if (failure !== "unsupported") act(() => { Socket.instances[0].open(); if (failure === "error") Socket.instances[0].onerror?.(); });
  if (failure === "timeout") await act(async () => vi.advanceTimersByTimeAsync(12000));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "停止评分" })); });
  expect(screen.getByText("91")).toBeVisible(); expect(assessmentPosts()).toHaveLength(1);
});
it("shows post-ready provider failure and releases capture immediately without buffered re-assessment", async () => {
  const { socket } = await ready(); await act(async () => { socket.message({ type: "error", message: "provider failed" }); });
  expect(stop).toHaveBeenCalledTimes(1); expect(captureSignal?.aborted).toBe(true);
  expect(screen.getByText("评测失败，重试")).toBeVisible(); expect(assessmentPosts()).toHaveLength(0);
  act(() => socket.message({ type: "result", result: score })); expect(screen.queryByText("91")).not.toBeInTheDocument();
});
it("bounds final-result silence and displays failure without a duplicate buffered request", async () => {
  await ready(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "停止评分" })); });
  await act(async () => vi.advanceTimersByTimeAsync(21000));
  expect(screen.getByText("评测失败，重试")).toBeVisible(); expect(assessmentPosts()).toHaveLength(0);
});
it("releases the microphone with a visible error at the 180-second recording limit", async () => {
  await ready(); await act(async () => vi.advanceTimersByTimeAsync(180000));
  expect(stop).toHaveBeenCalledTimes(1); expect(captureSignal?.aborted).toBe(true);
  expect(screen.getByText(/180秒/)).toBeVisible(); expect(assessmentPosts()).toHaveLength(0);
});
it.each(["identity", "unmount", "text"])("cancels a live stream on %s and ignores its late result", async cancellation => {
  const { view, socket } = await ready();
  if (cancellation === "identity") act(() => setToken("different-stream-owner"));
  else if (cancellation === "unmount") view.unmount(); else view.rerender(<PronounceButton text="A different line" />);
  await act(async () => { }); expect(socket.readyState).toBe(3); expect(stop).toHaveBeenCalledTimes(1);
  act(() => { emit?.(new ArrayBuffer(1280)); socket.message({ type: "result", result: score }); });
  expect(fetcher).not.toHaveBeenCalled(); expect(screen.queryByText("91")).not.toBeInTheDocument();
});
it("creates no provider socket when permission is denied or a pending grant is cancelled", async () => {
  vi.mocked(startRecording).mockRejectedValueOnce(new Error("denied")); await begin();
  expect(Socket.instances).toHaveLength(0); expect(screen.getByText("评测失败，重试")).toBeVisible();
  let grant!: (value: { stop: typeof stop }) => void;
  vi.mocked(startRecording).mockReturnValueOnce(new Promise(resolve => { grant = resolve; }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "跟读评分" })); });
  act(() => setToken("cancel-pending-grant")); await act(async () => { grant({ stop }); });
  expect(stop).toHaveBeenCalledTimes(1); expect(Socket.instances).toHaveLength(0); expect(fetcher).not.toHaveBeenCalled();
});
it("retries only saving the streamed score using the same receipt", async () => {
  fetcher.mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response("{}"));
  const { socket } = await ready(); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "停止评分" })); });
  await act(async () => { socket.message({ type: "result", result: score }); }); expect(screen.getByRole("alert")).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重试保存" })); });
  const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(init.body as string));
  expect(bodies[0].client_request_id).toEqual(expect.any(String)); expect(bodies[1].client_request_id).toBe(bodies[0].client_request_id);
  expect(startRecording).toHaveBeenCalledTimes(1); expect(Socket.instances).toHaveLength(1); expect(assessmentPosts()).toHaveLength(0);
});
