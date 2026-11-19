import { Bookmark, Check, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useSceneCues } from "../hooks/useSceneCues";
import { postHint, type ChatMessage, type CustomScene } from "../lib/api";
import { getAuthGeneration } from "../lib/authToken";
import "../scene-cues.css";

interface ReferenceProps {
  scenarioId: string;
  custom: CustomScene | null;
  messages: ChatMessage[];
  waiting: boolean;
  canInsert: boolean;
  insert: (sentence: string) => void;
}

const normalizeLine = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export function ConversationReferences({scenarioId, custom, messages, waiting, canInsert, insert}: ReferenceProps) {
  const library = useSceneCues(scenarioId, custom);
  const [open, setOpen] = useState<"prep" | "ai" | null>(null);
  const [requestedTurn, setRequestedTurn] = useState<string | null>(null);
  const last = messages[messages.length - 1];
  const turn = `${messages.length}:${last?.content ?? ""}`;
  const available = !waiting && last?.role === "assistant";
  const hasAI = available && requestedTurn === turn;
  const showAI = hasAI && open === "ai";
  const showPrep = open === "prep";
  const panel = useId();
  function insertLine(sentence: string) {
    insert(sentence);
    setOpen(null);
  }
  return <div className="cue-reference">
    <div className="cue-reference-controls">
      <button type="button" aria-expanded={showPrep} aria-controls={panel}
        onClick={() => setOpen(showPrep ? null : "prep")}>
        <Lightbulb size={16} />{showPrep ? "收起预习句型" : "查看预习句型"}
      </button>
      <button type="button" aria-expanded={showAI} aria-controls={panel} disabled={!available}
        onClick={() => { setRequestedTurn(turn); setOpen(showAI ? null : "ai"); }}><Sparkles size={16} />AI 提示</button>
    </div>
    <div id={panel}>
      {showPrep && !library.ready && !library.error && <p role="status" className="cue-status">正在读取你的预习…</p>}
      {showPrep && (library.ready || library.error) && (library.cues.length ? <ul className="cue-reference-list">{library.cues.map(cue => (
        <li key={cue.id}><button type="button" className="cue-insert" disabled={!canInsert}
          aria-label={`使用这句 ${cue.sentence}`} onClick={() => insertLine(cue.sentence)}>
          <span lang="en">{cue.sentence}</span>{cue.meaning && <small>{cue.meaning}</small>}
        </button></li>
      ))}</ul> : <p role="status">还没有预习内容。可以把 AI 提示里的表达收藏到这里。</p>)}
      {hasAI && <div hidden={!showAI}><AiSuggestions key={turn} scenarioId={scenarioId} custom={custom} messages={messages}
        library={library} canInsert={canInsert} insert={insertLine} /></div>}
      {(showPrep || showAI) && library.error && <p role="status" className="cue-status">
        {showPrep ? "个人预习暂时无法读取，先显示场景自带的表达。" : "读取个人预习后即可收藏。"}
        <button className="cue-text-action" type="button" onClick={library.retry}>重试读取</button></p>}
    </div>
  </div>;
}

function AiSuggestions({scenarioId, custom, messages, library, canInsert, insert}:
  Omit<ReferenceProps, "waiting"> & {library: ReturnType<typeof useSceneCues>}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState("");
  const scope = useRef<AbortController | null>(null);
  const generation = getAuthGeneration();

  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    void Promise.resolve().then(async () => {
      if (!current()) return;
      const suggestions = await postHint(scenarioId, messages, controller.signal, custom ?? undefined);
      if (current()) {
        if (suggestions.length) setLines(suggestions);
        else setLoadError(true);
      }
    }).catch(() => { if (current()) setLoadError(true); });
    return () => controller.abort();
  }, [attempt, custom, generation, messages, scenarioId]);

  function refresh() {
    setLines(null);
    setLoadError(false);
    setSaveError("");
    setAttempt(value => value + 1);
  }
  async function collect(line: string) {
    const active = scope.current;
    const current = () => active && !active.signal.aborted && generation === getAuthGeneration();
    if (saving || !current()) return;
    setSaving(line);
    setSaveError("");
    try { await library.addHint(line); }
    catch { if (current()) setSaveError("收藏暂未保存，请再试一次。"); }
    finally { if (current()) setSaving(""); }
  }
  if (loadError) return <p role="status" className="cue-status">AI 提示暂时无法生成。
    <button type="button" className="cue-text-action" onClick={refresh}>重试</button></p>;
  if (!lines) return <p role="status" className="cue-status">正在根据 Pip 刚才的话准备提示…</p>;
  return <>
    <ul className="cue-reference-list">{lines.map(line => {
      const saved = library.ready && library.cues.some(cue => normalizeLine(cue.sentence) === normalizeLine(line));
      return <li key={line}>
        <button type="button" className="cue-insert" disabled={!canInsert} lang="en" aria-label={`使用这句 ${line}`}
          onClick={() => insert(line)}>{line}</button>
        <button type="button" className="cue-bookmark" disabled={saved || !library.ready || Boolean(saving)}
          aria-label={`${saved ? "已在预习中" : "收藏到预习"} ${line}`} onClick={() => void collect(line)}>
          {saved ? <Check size={15} /> : <Bookmark size={15} />}
          {saved ? "已收藏" : saving === line ? "收藏中" : "收藏到预习"}
        </button>
      </li>;
    })}</ul>
    {saveError && <p role="alert" className="cue-status">{saveError}</p>}
    <button type="button" className="cue-text-action" onClick={refresh} disabled={Boolean(saving)}><RotateCcw size={13} />换一组</button>
  </>;
}
