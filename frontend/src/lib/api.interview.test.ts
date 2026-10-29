import { afterEach, expect, it, vi } from "vitest";
import { getInterviewSet, scoreInterview } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("defaults random draws to Inspire and preserves source and set id in explicit requests", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ questions: [] }) });
  vi.stubGlobal("fetch", fetcher);
  await getInterviewSet();
  await getInterviewSet("ets special/id", undefined, "ets");
  await getInterviewSet(undefined, undefined, "all");
  const urls = fetcher.mock.calls.map(([url]) => new URL(url, "https://example.test"));
  expect(urls[0].searchParams.get("source")).toBe("inspire");
  expect(urls[1].searchParams.get("source")).toBe("ets");
  expect(urls[1].searchParams.get("set_id")).toBe("ets special/id");
  expect(urls[2].searchParams.get("source")).toBe("all");
  expect(urls.every((url) => url.searchParams.get("ai") === "false")).toBe(true);
});

it("sends the selected set identity when scoring while accepting legacy calls", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ overall: 4, results: [] }) });
  vi.stubGlobal("fetch", fetcher);
  const items = [{ question: "What do you enjoy?", answer: "Running." }];
  const controller = new AbortController();
  await scoreInterview(items, controller.signal, "inspire-190");
  await scoreInterview(items, controller.signal);
  await scoreInterview(items);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ items, set_id: "inspire-190" });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ items });
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ items });
});
