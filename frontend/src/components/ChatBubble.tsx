import { Volume2 } from "lucide-react";
import type { ScenarioTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { PronounceButton } from "./PronounceButton";
import {
  TurnCorrectionCard,
  type TurnCorrectionCardProps,
} from "./TurnCorrectionCard";

export interface ChatBubbleProps {
  role: "user" | "assistant";
  text: string;
  theme: ScenarioTheme;
  onSpeak?: () => void;
  correction?: TurnCorrectionCardProps;
}

export function ChatBubble({
  role,
  text,
  theme,
  onSpeak,
  correction,
}: ChatBubbleProps) {
  const isPip = role === "assistant";

  return (
    <div className={cn("chat-turn flex", isPip ? "pip-turn justify-start" : "user-turn justify-end")}>
      <div
        className={cn(
          "chat-message max-w-[88%] rounded-3xl px-4 py-3 shadow-soft sm:max-w-[80%]",
          isPip ? "rounded-tl-md" : "rounded-tr-md",
        )}
        style={
          isPip
            ? { background: theme.soft, color: "var(--ink)" }
            : { background: "#f7eee2", color: "var(--ink)" }
        }
      >
        <p className="text-[0.66rem] font-bold uppercase tracking-wide opacity-70">
          {isPip ? "Pip" : "You"}
        </p>
        <p className="mt-0.5 leading-snug">
          <InteractiveEnglishText text={text} />
        </p>
        {isPip && (
          <div className="mt-1.5 flex flex-col gap-1">
            {onSpeak && (
              <button
                type="button"
                onClick={onSpeak}
                aria-label="朗读"
                className="inline-flex w-fit items-center gap-1 text-[0.66rem] font-bold uppercase tracking-wide opacity-60 transition-opacity hover:opacity-100"
              >
                <Volume2 className="h-3.5 w-3.5" />
                朗读
              </button>
            )}
            <PronounceButton text={text} />
          </div>
        )}
        {!isPip && correction && <TurnCorrectionCard {...correction} />}
      </div>
    </div>
  );
}
