import { Bookmark, CornerDownRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ChatMessage, Correction, CustomScene } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { containsCorrection } from "../lib/correctionDrill";
import { correctionDrills, correctionKey, isCorrectionCategory, sentenceForReplay } from "../lib/practiceCorrections";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { QuickCorrectionPractice } from "./QuickCorrectionPractice";
import { SentenceReplay } from "./SentenceReplay";
import "../coaching.css";

export function CorrectionReview({ corrections, messages, scenarioId, custom, className = "" }: {
  corrections: Correction[];
  messages: ChatMessage[];
  scenarioId: string | null;
  custom?: CustomScene;
  className?: string;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const learnerTurns = new Map<number, number>();
  messages.forEach((message, index) => {
    if (message.role === "user") learnerTurns.set(index, learnerTurns.size + 1);
  });
  const byTurn = new Map<number | null, Correction[]>();
  for (const fix of corrections) {
    let index = fix.turn_index != null && learnerTurns.has(fix.turn_index) ? fix.turn_index : null;
    if (fix.turn_index == null && !fix.self_marked) {
      const matches = [...learnerTurns.keys()].filter(turn => containsCorrection(messages[turn].content, fix));
      if (matches.length === 1) index = matches[0];
    }
    const group = byTurn.get(index) ?? [];
    group.push(index !== null && fix.turn_index == null ? { ...fix, turn_index: index } : fix);
    byTurn.set(index, group);
  }
  const scene = scenarioId && getScenario(scenarioId) ? scenarioId : "custom";

  return (
    <section className={`coaching-review ${className}`} aria-label="句子纠错">
      <div className="coaching-heading"><h2>句子纠错</h2><RotateCcw size={21} aria-hidden="true" /></div>
      {corrections.length === 0 ? <p className="text-sm text-muted">这次没有标出需要复练的句子。</p> : (
        <ul className="review-turns">
          {[...byTurn].map(([index, fixes]) => {
            const marked = fixes.some((fix) => fix.marked);
            const replay = index !== null ? sentenceForReplay(messages, fixes, index) : undefined;
            return (
              <li key={index ?? "legacy"} className="review-turn">
                <div className="review-turn-meta">
                  <span>{index !== null ? `你的第 ${learnerTurns.get(index)} 句` : "表达建议"}</span>
                  {marked && <span className="review-marked"><Bookmark size={13} fill="currentColor" /> 已标记复练</span>}
                </div>
                {replay && <p className="review-full-line" lang="en"><InteractiveEnglishText text={replay.original} /></p>}
                {fixes.filter((fix) => !fix.self_marked).sort((a, b) => Number(a.category === "word_choice") - Number(b.category === "word_choice")).map((fix) => (
                  <div className="review-fix" key={correctionKey(fix)}>
                    {isCorrectionCategory(fix.category ?? null) && <span className="coaching-tag">{correctionDrills[fix.category!].label}</span>}
                    <QuickCorrectionPractice correction={fix} selected={quick === correctionKey(fix)}
                      fragmentOnly={!replay}
                      onOpen={() => { setQuick(correctionKey(fix)); setOpened(null); }}
                      example={replay ?? { original: fix.original, previous_partner_message: "", corrections: [fix] }}>
                      <div className="review-pair" lang="en">
                        <del><InteractiveEnglishText text={fix.original} /></del>
                        <CornerDownRight size={15} aria-hidden="true" />
                        <strong><InteractiveEnglishText text={fix.suggestion} /></strong>
                      </div>
                      <p>{fix.note}</p>
                    </QuickCorrectionPractice>
                  </div>
                ))}
                {index !== null && replay && <button type="button" className="coaching-secondary print:hidden" aria-expanded={opened === index}
                  onClick={() => { setQuick(null); setOpened(opened === index ? null : index); }}><RotateCcw size={16} /> {opened === index ? "收起原句复练" : "重练原句"}</button>}
                {replay && index !== null && opened === index && <div className="print:hidden"><SentenceReplay example={replay} scenarioId={scene} custom={custom} /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
