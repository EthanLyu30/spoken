import {
  Fragment,
  useState,
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
  const wordIndexes = parts.flatMap((part, index) => WORD_TOKEN_RE.test(part) ? [index] : []);
  const [activeWord, setActiveWord] = useState<number | null>(null);
  const tabStop = activeWord !== null && wordIndexes.includes(activeWord) ? activeWord : wordIndexes[0];

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
            tabIndex={index === tabStop ? 0 : -1}
            data-dictionary-word
            aria-label={`查询 ${part}`}
            className={cn(
              "cursor-help select-text rounded-sm decoration-dotted decoration-current/35 underline-offset-2 hover:underline focus-visible:underline",
            )}
            onClick={(event) =>
              openWord(part, event.currentTarget, event)
            }
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const words = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-dictionary-word]");
                if (!words?.length) return;
                const current = Array.from(words).indexOf(event.currentTarget);
                const target = event.key === "Home" ? 0 : event.key === "End" ? words.length - 1 : Math.max(0, Math.min(words.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
                setActiveWord(wordIndexes[target]);
                words[target].focus();
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openWord(part, event.currentTarget, event);
              }
            }}
            onFocus={() => setActiveWord(index)}
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
