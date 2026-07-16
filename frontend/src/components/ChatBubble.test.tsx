import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fallbackTheme } from "../lib/theme";
import { DictionaryProvider } from "./dictionary/DictionaryProvider";
import { ChatBubble } from "./ChatBubble";

describe("ChatBubble", () => {
  it("renders message words as dictionary triggers without losing punctuation", () => {
    const { container } = render(
      <DictionaryProvider>
        <ChatBubble
          role="user"
          text="Hello, world!"
          theme={fallbackTheme}
        />
      </DictionaryProvider>,
    );

    expect(container).toHaveTextContent("Hello, world!");
    expect(
      screen.getByRole("button", { name: "查询 Hello" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查询 world" }),
    ).toBeInTheDocument();
  });
});
