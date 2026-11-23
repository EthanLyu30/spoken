import { afterEach, expect, it, vi } from "vitest";
import { getHealth, getInterviewQuestions, getInterviewSet, getInterviewSets, getScenarioSuggestion, request } from "./api";
import { clearToken, setToken } from "./authToken";

afterEach(() => { clearToken(); vi.unstubAllGlobals(); });

it("uses simple requests for the public homepage and interview reads even when signed in", async () => {
  setToken("local-test-account");
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ sets: [] }));
  vi.stubGlobal("fetch", fetcher);
  await getHealth();
  await getScenarioSuggestion(false);
  await getInterviewSets();
  await getInterviewSet("inspire-writing-190");
  for (const [, init] of fetcher.mock.calls) {
    expect(init?.credentials).toBe("omit");
    expect(Array.from(new Headers(init?.headers).keys())).toEqual([]);
  }
  await request("/api/stats");
  const privateHeaders = new Headers(fetcher.mock.lastCall?.[1]?.headers);
  expect(privateHeaders.get("Authorization")).toBe("Bearer local-test-account");
  expect(privateHeaders.has("X-Client-Id")).toBe(true);
});

it("retains diagnostic tagging on explicitly marked public reads", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ status: "ok" }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("__TEST_RUN_ID__", "public-metadata-smoke");
  await getHealth();
  expect(new Headers(fetcher.mock.lastCall?.[1]?.headers).get("X-Test-Run-Id")).toBe("public-metadata-smoke");
});

it("fetches live health, regenerated scenes and random draws without reusing an HTTP cache entry", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ questions: [] }));
  vi.stubGlobal("fetch", fetcher);
  await getHealth();
  await getScenarioSuggestion(true);
  await getInterviewSet();
  await getInterviewQuestions();
  for (const [, init] of fetcher.mock.calls) expect(init?.cache).toBe("no-store");
});
