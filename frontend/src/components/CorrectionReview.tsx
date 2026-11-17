import { Link } from "react-router-dom";
import type { ChatMessage, Correction } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { correctionDrills, correctionKey, isCorrectionCategory } from "../lib/practiceCorrections";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";

export function CorrectionReview({ corrections, messages, scenarioId, className = "" }: {
  corrections: Correction[];
  messages: ChatMessage[];
  scenarioId: string | null;
  className?: string;
}) {
  const learnerTurns = new Map<number, number>();
  messages.forEach((message, index) => {
    if (message.role === "user") learnerTurns.set(index, learnerTurns.size + 1);
  });
  const scene = scenarioId && getScenario(scenarioId) ? scenarioId : "cafe";

  return (
    <section className={`card p-6 ${className}`} aria-label="句子纠错">
      <h2 className="font-display text-lg font-semibold text-ink">句子纠错</h2>
      {corrections.length === 0 ? (
        <p className="mt-3 text-sm text-muted">这次没有标出需要复练的句子。</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {corrections.map((entry) => {
            const category = entry.category ?? null;
            const drill = isCorrectionCategory(category) ? correctionDrills[category] : null;
            const turn = entry.turn_index != null ? learnerTurns.get(entry.turn_index) : null;
            return (
              <li key={correctionKey(entry)} className="rounded-2xl bg-surface-2 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted">
                  {turn && <span>你的第 {turn} 句</span>}
                  {drill && <span className="rounded-full bg-surface px-2 py-0.5 text-coral-deep">{drill.label}</span>}
                  {entry.marked && <span>已标记复练</span>}
                </div>
                <p className="break-words text-sm text-muted" lang="en">
                  <span className="sr-only" lang="zh-CN">原句片段</span><InteractiveEnglishText text={entry.original} className="line-through" />
                </p>
                <p className="mt-1 break-words text-sm font-bold text-leaf-deep" lang="en">
                  <span className="sr-only" lang="zh-CN">推荐说法</span><InteractiveEnglishText text={entry.suggestion} />
                </p>
                <p className="mt-2 break-words text-sm text-ink">{entry.note}</p>
                {drill && (
                  <Link to={`/prepare/${scene}?focus=${category}`} className="mt-2 inline-flex min-h-8 items-center text-xs font-bold text-ink underline underline-offset-2">
                    复练{drill.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
