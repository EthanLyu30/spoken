import { beforeEach, describe, expect, it, vi } from "vitest";
import { postDictionaryLookup } from "./api";
import {
  clearDictionarySessionCache,
  getDictionaryEntry,
  normalizeDictionaryQuery,
} from "./dictionary";

vi.mock("./api", () => ({
  postDictionaryLookup: vi.fn(),
}));

const entry = {
  query: "run into",
  phonetic: "",
  part_of_speech: "phrasal verb",
  meaning: "偶然遇见",
  example: "I ran into a friend.",
  example_zh: "我偶遇了一位朋友。",
};

describe("dictionary session client", () => {
  beforeEach(() => {
    clearDictionarySessionCache();
    vi.mocked(postDictionaryLookup).mockReset();
    vi.mocked(postDictionaryLookup).mockResolvedValue(entry);
  });

  it("normalizes punctuation and spacing and rejects invalid selections", () => {
    expect(normalizeDictionaryQuery("  run   into, ")).toBe("run into");
    expect(normalizeDictionaryQuery("123")).toBeNull();
    expect(
      normalizeDictionaryQuery("one two three four five six seven"),
    ).toBeNull();
    expect(normalizeDictionaryQuery("x".repeat(81))).toBeNull();
  });

  it("returns a cached value without a second request", async () => {
    await getDictionaryEntry("Run Into");
    await getDictionaryEntry("run into");

    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent requests", async () => {
    let resolve!: (value: typeof entry) => void;
    vi.mocked(postDictionaryLookup).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const first = getDictionaryEntry("run into");
    const second = getDictionaryEntry("Run Into");
    resolve(entry);

    await expect(first).resolves.toEqual(entry);
    await expect(second).resolves.toEqual(entry);
    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });

  it("lets one subscriber abort without cancelling the shared lookup", async () => {
    let resolve!: (value: typeof entry) => void;
    vi.mocked(postDictionaryLookup).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const controller = new AbortController();
    const oldSubscriber = getDictionaryEntry("run into", controller.signal);
    const currentSubscriber = getDictionaryEntry("Run Into");

    controller.abort();
    resolve(entry);

    await expect(oldSubscriber).rejects.toMatchObject({ name: "AbortError" });
    await expect(currentSubscriber).resolves.toEqual(entry);
    expect(postDictionaryLookup).toHaveBeenCalledTimes(1);
  });
});
