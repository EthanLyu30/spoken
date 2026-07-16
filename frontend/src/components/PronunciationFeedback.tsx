import { useState } from "react";
import type { PronunciationResult } from "../lib/api";
import { cn } from "../lib/utils";

function scoreColor(score: number): string {
  if (score >= 85) return "#2fa274";
  if (score >= 70) return "#e07f1c";
  return "#e6503d";
}

export function PronunciationFeedback({
  result,
  title = "发音参考",
}: {
  result: PronunciationResult;
  title?: string;
}) {
  const [openWord, setOpenWord] = useState<number | null>(null);

  return (
    <section className="mt-3 rounded-2xl bg-surface px-3 py-2 shadow-soft">
      <p className="text-[0.66rem] font-bold uppercase tracking-wide text-muted">
        {title}
      </p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className="font-display text-lg font-bold tabnum"
          style={{ color: scoreColor(result.overall) }}
        >
          {Math.round(result.overall)}
        </span>
        <span className="text-[0.6rem] font-bold uppercase text-muted">/ 100</span>
        <span className="text-[0.62rem] text-muted">
          准确 {Math.round(result.accuracy)} · 流利 {Math.round(result.fluency)} · 完整{" "}
          {Math.round(result.integrity)}
        </span>
      </div>
      {result.words.length > 0 && (
        <>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
            {result.words.map((word, index) => {
              const expandable = (word.phonemes?.length ?? 0) > 0;
              return (
                <button
                  key={`${word.word}-${index}`}
                  type="button"
                  onClick={() =>
                    expandable && setOpenWord(openWord === index ? null : index)
                  }
                  className={cn(
                    "text-sm font-semibold",
                    expandable && "underline decoration-dotted underline-offset-2",
                  )}
                  style={{ color: scoreColor(word.score) }}
                  aria-label={`${word.word}，${Math.round(word.score)} 分${
                    expandable ? "，查看音素" : ""
                  }`}
                >
                  {word.word}
                </button>
              );
            })}
          </p>
          {openWord !== null &&
            (result.words[openWord]?.phonemes?.length ?? 0) > 0 && (
              <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-[0.6rem] font-bold uppercase tracking-wide text-muted">
                  音素 · {result.words[openWord].word}
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {result.words[openWord].phonemes!.map((phoneme, index) => (
                    <span
                      key={`${phoneme.label}-${index}`}
                      className="rounded px-1.5 py-0.5 text-xs font-bold"
                      style={{
                        background: phoneme.ok ? "#e2f6ee" : "#ffe8e3",
                        color: phoneme.ok ? "#2fa274" : "#e6503d",
                      }}
                    >
                      {phoneme.label}
                    </span>
                  ))}
                </p>
                <p className="mt-1 text-[0.6rem] text-muted">
                  绿色=读准 · 红色=有偏差
                </p>
              </div>
            )}
        </>
      )}
    </section>
  );
}
