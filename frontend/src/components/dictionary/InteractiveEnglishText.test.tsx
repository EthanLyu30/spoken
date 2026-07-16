import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postDictionaryLookup } from "../../lib/api";
import { clearDictionarySessionCache } from "../../lib/dictionary";
import { DictionaryProvider } from "./DictionaryProvider";
import { InteractiveEnglishText } from "./InteractiveEnglishText";

const { collectWord } = vi.hoisted(() => ({
  collectWord: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  postDictionaryLookup: vi.fn(),
}));

vi.mock("../../lib/speech", () => ({
  speakText: vi.fn(() => ({
    done: Promise.resolve(),
    stop: vi.fn(),
  })),
}));

vi.mock("../../store/words", () => ({
  useWords: (
    selector: (state: {
      words: never[];
      collect: typeof collectWord;
    }) => unknown,
  ) => selector({ words: [], collect: collectWord }),
}));

const worldEntry = {
  query: "world",
  phonetic: "/wɜːrld/",
  part_of_speech: "noun",
  meaning: "世界",
  example: "The world is changing.",
  example_zh: "世界正在变化。",
};

describe("InteractiveEnglishText", () => {
  beforeEach(() => {
    clearDictionarySessionCache();
    collectWord.mockReset();
    vi.mocked(postDictionaryLookup).mockReset();
    vi.mocked(postDictionaryLookup).mockResolvedValue(worldEntry);
  });

  it("keeps punctuation visible and opens a word lookup", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DictionaryProvider>
        <InteractiveEnglishText text="Hello, world!" />
      </DictionaryProvider>,
    );

    expect(container).toHaveTextContent("Hello, world!");
    await user.click(screen.getByRole("button", { name: "查询 world" }));

    expect(await screen.findByText("世界")).toBeInTheDocument();
    expect(postDictionaryLookup).toHaveBeenCalledWith("world");
  });

  it("does not fire a word click while a phrase selection exists", async () => {
    const user = userEvent.setup();
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      toString: () => "Hello world",
    } as unknown as Selection);
    render(
      <DictionaryProvider>
        <InteractiveEnglishText text="Hello world" />
      </DictionaryProvider>,
    );

    await user.click(screen.getByRole("button", { name: "查询 Hello" }));

    expect(postDictionaryLookup).not.toHaveBeenCalled();
    getSelection.mockRestore();
  });

  it("opens a lookup for a selected short phrase", async () => {
    vi.mocked(postDictionaryLookup).mockResolvedValue({
      ...worldEntry,
      query: "run into",
      phonetic: "",
      part_of_speech: "phrasal verb",
      meaning: "偶然遇见",
      example: "I ran into an old friend.",
      example_zh: "我偶遇了一位老朋友。",
    });
    const { container } = render(
      <DictionaryProvider>
        <InteractiveEnglishText text="I may run into an old friend." />
      </DictionaryProvider>,
    );
    const root = container.querySelector("[data-dictionary-text]");
    expect(root).not.toBeNull();
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: root,
      toString: () => "run into",
      getRangeAt: () =>
        ({
          getBoundingClientRect: () => new DOMRect(20, 30, 80, 20),
        }) as Range,
    } as unknown as Selection);

    fireEvent.mouseUp(document);

    expect(await screen.findByText("偶然遇见")).toBeInTheDocument();
    expect(postDictionaryLookup).toHaveBeenCalledWith("run into");
    getSelection.mockRestore();
  });

  it("adds a loaded word to the word bag", async () => {
    const user = userEvent.setup();
    render(
      <DictionaryProvider>
        <InteractiveEnglishText text="world" />
      </DictionaryProvider>,
    );

    await user.click(screen.getByRole("button", { name: "查询 world" }));
    await user.click(
      await screen.findByRole("button", { name: "加入生词本" }),
    );

    expect(collectWord).toHaveBeenCalledWith({
      text: "world",
      meaning: "世界",
      example: "The world is changing.",
      kind: "word",
    });
  });
});
