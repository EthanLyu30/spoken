import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PronounceButton } from "./PronounceButton";
import { setToken } from "../lib/authToken";
import { startRecording } from "../lib/recorder";
import * as api from "../lib/api";

vi.mock("../lib/recorder", () => ({ startRecording: vi.fn() }));
const pcm = new Int16Array([1, -1]).buffer;
const score = { overall: 91, accuracy: 92, fluency: 93, integrity: 94, standard: 95, words: [] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
let stop: ReturnType<typeof vi.fn>;
let saves: { owner: string; body: unknown; signal: AbortSignal }[];
let scoring: ReturnType<typeof deferred<Response>>;
let saving: ReturnType<typeof deferred<Response>>;
beforeEach(() => {
  setToken("pronounce-a");
  stop = vi.fn().mockResolvedValue(pcm);
  vi.mocked(startRecording).mockReset().mockResolvedValue({ stop });
  saves = [];
  scoring = deferred<Response>();
  saving = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    if (url.includes("/api/pronunciation")) return scoring.promise;
    if (url.endsWith("/api/practice")) {
      saves.push({ owner: (init.headers as Record<string, string>).Authorization,
        body: JSON.parse(init.body as string), signal: init.signal as AbortSignal });
      return saving.promise;
    }
    throw new Error(`Unexpected request ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function record() {
  const view = render(<PronounceButton text="Original owner line" />);
  fireEvent.click(screen.getByRole("button", { name: "跟读评分" }));
  await screen.findByRole("button", { name: "停止评分" });
  return view;
}
function changeOwner(back: boolean) {
  setToken("pronounce-b");
  if (back) setToken("pronounce-a");
}
async function finishScore() {
  await act(async () => { scoring.resolve(new Response(JSON.stringify(score))); });
}

it.each([false, true])("never uploads audio after a delayed stop crosses identity (ABA=%s)", async back => {
  const stopped = deferred<ArrayBuffer>();
  stop.mockReturnValue(stopped.promise);
  await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  act(() => changeOwner(back));
  await act(async () => { stopped.resolve(pcm); });
  expect(fetch).not.toHaveBeenCalled();
  expect(saves).toEqual([]);
  expect(screen.queryByText("评测失败，重试")).not.toBeInTheDocument();
});

it("does not upload a delayed stop after ordinary unmount", async () => {
  const stopped = deferred<ArrayBuffer>();
  stop.mockReturnValue(stopped.promise);
  const view = await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  view.unmount();
  await act(async () => { stopped.resolve(pcm); });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([false, true])("never saves a delayed score after identity and route unmount (ABA=%s)", async back => {
  const view = await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  act(() => changeOwner(back));
  view.unmount();
  await finishScore();
  expect(saves).toEqual([]);
});

it.each([false, true])("guards the component continuation even if scoring ignores cancellation (ABA=%s)", async back => {
  const result = deferred<api.PronunciationResult>();
  const scoreCall = vi.spyOn(api, "postPronunciation").mockReturnValue(result.promise);
  await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  await waitFor(() => expect(scoreCall).toHaveBeenCalledOnce());
  act(() => changeOwner(back));
  await act(async () => { result.resolve(score); });
  expect(saves).toEqual([]);
  expect(screen.queryByText("91")).not.toBeInTheDocument();
});

it("aborts scoring and hides feedback immediately on identity change without waiting for route cleanup", async () => {
  await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
  act(() => changeOwner(false));
  expect(signal.aborted).toBe(true);
  await finishScore();
  expect(screen.queryByText("91")).not.toBeInTheDocument();
  expect(saves).toEqual([]);
});

it.each(["identity", "unmount"])("releases an active recorder on %s", async cancellation => {
  const view = await record();
  if (cancellation === "unmount") view.unmount(); else act(() => changeOwner(false));
  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["identity", "aba", "unmount"])("releases a late microphone grant after %s without recording or uploading", async cancellation => {
  const grant = deferred<{ stop: typeof stop }>();
  vi.mocked(startRecording).mockReturnValue(grant.promise);
  const view = render(<PronounceButton text="Original owner line" />);
  fireEvent.click(screen.getByRole("button"));
  if (cancellation === "unmount") view.unmount(); else act(() => changeOwner(cancellation === "aba"));
  await act(async () => { grant.resolve({ stop }); });
  expect(stop).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "停止评分" })).not.toBeInTheDocument();
});

it("prevents duplicate pending microphone grants and preserves same-owner scoring and dispatched save", async () => {
  const grant = deferred<{ stop: typeof stop }>();
  vi.mocked(startRecording).mockReturnValue(grant.promise);
  const view = render(<PronounceButton text="Original owner line" />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button"));
  expect(startRecording).toHaveBeenCalledOnce();
  await act(async () => { grant.resolve({ stop }); });
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await finishScore();
  expect(screen.getByText("91")).toBeInTheDocument();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ owner: "Bearer pronounce-a",
    body: { kind: "pronunciation", score: 91, title: "Original owner line" } });
  view.unmount();
  act(() => changeOwner(false));
  expect(saves[0].signal.aborted).toBe(false);
  await act(async () => { saving.resolve(new Response("{}")); });
});

it("shows a same-owner scoring failure and permits another recording", async () => {
  await record();
  fireEvent.click(screen.getByRole("button", { name: "停止评分" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => { scoring.resolve(new Response("{}", { status: 503 })); });
  expect(screen.getByText("评测失败，重试")).toBeInTheDocument();
  expect(saves).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "跟读评分" }));
  await screen.findByRole("button", { name: "停止评分" });
  expect(startRecording).toHaveBeenCalledTimes(2);
});
