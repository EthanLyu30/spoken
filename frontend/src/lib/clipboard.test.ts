import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a hidden textarea when navigator.clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("blocked")),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn().mockReturnValue(true),
    });

    await copyText("correct sentence");

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
