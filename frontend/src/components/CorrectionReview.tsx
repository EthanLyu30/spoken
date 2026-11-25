import { Bookmark, Check, CornerDownRight, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, setCorrectionPractice, type ChatMessage, type Correction, type CustomScene } from "../lib/api";
import { getScenario } from "../data/scenarios";
import { getAuthGeneration } from "../lib/authToken";
import { containsCorrection } from "../lib/correctionDrill";
import { correctionDrills, correctionKey, isCorrectionCategory, sentenceForReplay } from "../lib/practiceCorrections";
import { syncSavedCorrections } from "../lib/sessionSave";
import { InteractiveEnglishText } from "./dictionary/InteractiveEnglishText";
import { QuickCorrectionPractice } from "./QuickCorrectionPractice";
import { SentenceReplay } from "./SentenceReplay";
import "../coaching.css";

export function CorrectionReview({ corrections, messages, scenarioId, custom, sessionId, sessionCreatedAt, onCorrectionsChange, className = "" }: {
  corrections: Correction[];
  messages: ChatMessage[];
  scenarioId: string | null;
  custom?: CustomScene;
  sessionId?: number;
  sessionCreatedAt?: string;
  onCorrectionsChange?: (corrections: Correction[]) => void;
  className?: string;
}) {
  const [opened, setOpened] = useState<number | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  const [generation] = useState(getAuthGeneration);
  useEffect(() => () => active.current?.abort(), []);

  async function select(fix: Correction, turn: number | null) {
    if (!sessionId || !sessionCreatedAt || !onCorrectionsChange || active.current || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    const key = correctionKey(fix);
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    active.current = controller;
    setPending(key);
    setError(null);
    try {
      const target = fix.marked ? fix : { ...fix, turn_index: turn };
      const updated = await setCorrectionPractice(sessionId, sessionCreatedAt, target, !fix.marked, controller.signal);
      if (!current()) return;
      syncSavedCorrections(sessionId, sessionCreatedAt, updated);
      onCorrectionsChange(updated);
    } catch (err) {
      if (current()) setError({ key, message: err instanceof ApiError && err.status === 409
        ? err.message : "复练选择暂未保存，请再试一次。" });
    } finally {
      active.current = null;
      if (current()) setPending(null);
    }
  }

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
    group.push(fix);
    byTurn.set(index, group);
  }
  const scene = scenarioId && getScenario(scenarioId) ? scenarioId : "custom";

  return (
    <section className={`coaching-review ${className}`} aria-label="句子纠错">
      <div className="coaching-heading"><h2>句子纠错</h2><RotateCcw size={21} aria-hidden="true" /></div>
      {corrections.length === 0 ? <p className="text-sm text-muted">这次没有句子纠错。</p> : (
        <ul className="review-turns">
          {[...byTurn].map(([index, fixes]) => {
            const favorite = fixes.find((fix) => fix.self_marked);
            const issues = fixes.filter((fix) => !fix.self_marked)
              .sort((a, b) => Number(a.category === "word_choice") - Number(b.category === "word_choice"));
            const replay = index !== null ? sentenceForReplay(messages, issues.map((fix) => ({ ...fix, turn_index: index })), index) : undefined;
            const line = replay?.original ?? favorite?.original;
            const savedSuggestion = favorite?.suggestion.trim();
            return (
              <li key={index ?? "legacy"} id={`correction-turn-${index ?? "legacy"}`} tabIndex={-1} className="review-turn">
                <div className="review-turn-meta">
                  <span>{index !== null ? `你的第 ${learnerTurns.get(index)} 句` : "表达建议"}</span>
                  {favorite && <span className="review-favorite"><Bookmark size={13} aria-hidden="true" /> 已收藏</span>}
                </div>
                {line && <p className="review-full-line" lang="en"><InteractiveEnglishText text={line} /></p>}
                {savedSuggestion && savedSuggestion !== line?.trim() && <div className="review-fix">
                  <p className="review-note">收藏的表达</p>
                  <p className="review-pair" lang="en"><strong><InteractiveEnglishText text={savedSuggestion} /></strong></p>
                </div>}
                {issues.map((fix) => {
                  const key = correctionKey(fix);
                  const feedback = <>
                      <div className="review-pair" lang="en">
                        <del><InteractiveEnglishText text={fix.original} /></del>
                        <CornerDownRight size={15} aria-hidden="true" />
                        <strong><InteractiveEnglishText text={fix.suggestion} /></strong>
                      </div>
                      <p className="review-note">{fix.note}</p>
                  </>;
                  return <div className="review-fix" key={key}>
                    <div className="review-turn-meta">
                      {isCorrectionCategory(fix.category ?? null) && <span className="coaching-tag">{correctionDrills[fix.category!].label}</span>}
                      {fix.marked && <span className="review-marked"><Check size={13} aria-hidden="true" /> 已加入复练</span>}
                    </div>
                    {fix.marked ? <QuickCorrectionPractice correction={fix} selected={quick === key}
                      fragmentOnly={!replay} onOpen={() => { setQuick(key); setOpened(null); }}
                      example={replay ?? { original: fix.original, previous_partner_message: "", corrections: [fix] }}>
                      {feedback}
                    </QuickCorrectionPractice> : feedback}
                    {sessionId && sessionCreatedAt && onCorrectionsChange && (index !== null || fix.marked) && <button type="button"
                      disabled={pending !== null} className={`coaching-secondary review-choice print:hidden${fix.marked ? " is-selected" : ""}`}
                      onClick={() => void select(fix, index)}>
                      {!fix.marked && <Plus size={15} aria-hidden="true" />}
                      {pending === key ? "保存中…" : fix.marked ? "移出复练" : "加入复练"}
                    </button>}
                    {error?.key === key && <p role="alert" className="replay-error">{error.message}</p>}
                  </div>;
                })}
                {index !== null && replay && issues.length > 0 && <button type="button" className="coaching-secondary print:hidden" aria-expanded={opened === index}
                  onClick={() => { setQuick(null); setOpened(opened === index ? null : index); }}><RotateCcw size={16} /> {opened === index ? "收起原句复练" : "重练原句"}</button>}
                {replay && issues.length > 0 && index !== null && opened === index && <div className="print:hidden"><SentenceReplay example={replay} scenarioId={scene} custom={custom} /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
