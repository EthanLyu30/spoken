import {
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { cn } from "../../lib/utils";
import { useDictionary } from "./DictionaryContext";

const TOKEN_RE = /([A-Za-z]+(?:['’-][A-Za-z]+)*)/g;
const WORD_TOKEN_RE = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/;

export function InteractiveEnglishText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { openDictionary } = useDictionary();
  const parts = text.split(TOKEN_RE);

  function selectedPhraseExists(): boolean {
    const selection = window.getSelection();
    return Boolean(
      selection &&
        !selection.isCollapsed &&
        selection.toString().trim(),
    );
  }

  function openWord(
    word: string,
    target: HTMLElement,
    event?: MouseEvent | KeyboardEvent,
  ) {
    event?.stopPropagation();
    if (selectedPhraseExists()) return;
    openDictionary({
      query: word,
      rect: target.getBoundingClientRect(),
      trigger: target,
    });
  }

  return (
    <span data-dictionary-text tabIndex={-1} className={className}>
      {parts.map((part, index) =>
        WORD_TOKEN_RE.test(part) ? (
          <span
            key={`${part}-${index}`}
            role="button"
            tabIndex={0}
            aria-label={`查询 ${part}`}
            className={cn(
              "cursor-help select-text rounded-sm underline decoration-dotted decoration-current/35 underline-offset-2",
            )}
            onClick={(event) =>
              openWord(part, event.currentTarget, event)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openWord(part, event.currentTarget, event);
              }
            }}
          >
            {part}
          </span>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
