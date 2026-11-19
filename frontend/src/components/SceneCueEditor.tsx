import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SceneCue, useSceneCues } from "../hooks/useSceneCues";
import "../scene-cues.css";

type CueLibrary = ReturnType<typeof useSceneCues>;
const kinds: Record<SceneCue["kind"], string> = { word: "单词", phrase: "词组", pattern: "句型" };

export function SceneCueEditor({ library, heading }: { library: CueLibrary; heading?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const editorId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const selected = library.cues.find(cue => cue.id === selectedId);

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  return <>
    <div className="cue-editor-heading">
      {heading}
      <button type="button" className="cue-text-action" ref={toggle} aria-expanded={open} aria-controls={editorId}
        onClick={() => { setSelectedId(library.cues[0]?.id ?? ""); setOpen(!open); }}>
        {open ? <X size={15} /> : <Pencil size={15} />}{open ? "收起编辑" : "编辑预习"}
      </button>
    </div>
    {!open && library.error && <p role="status" className="cue-status">个人预习暂时无法读取，先显示场景自带的表达。
      <button type="button" className="cue-text-action" onClick={library.retry}>重试读取</button>
    </p>}
    <div id={editorId} hidden={!open}>
      {open && (!library.ready
        ? <p role="status">{library.error ? <>个人预习暂时无法读取。 <button type="button" className="cue-text-action" onClick={library.retry}>重试</button></> : "正在读取个人预习…"}</p>
        : <div className="cue-editor">
          <label><span id={editorId + "-selection"}>选择预习内容</span>
            <select aria-labelledby={editorId + "-selection"} value={selected?.id ?? ""}
              onChange={event => setSelectedId(event.target.value)}>
              <option value="">＋ 添加新表达</option>
              {Object.entries(kinds).map(([kind, label]) => {
                const matching = library.cues.filter(cue => cue.kind === kind);
                return matching.length ? <optgroup key={kind} label={label}>
                  {matching.map(cue => <option key={cue.id} value={cue.id}>{cue.keyword}</option>)}
                </optgroup> : null;
              })}
            </select>
          </label>
          <CueForm key={selected?.id ?? "new"} cue={selected} library={library} close={close} />
        </div>)}
    </div>
  </>;
}

function CueForm({ cue, library, close }: {cue?: SceneCue; library: CueLibrary; close: () => void}) {
  const [kind, setKind] = useState<SceneCue["kind"]>(cue?.kind ?? "phrase");
  const [keyword, setKeyword] = useState(cue?.keyword ?? "");
  const [meaning, setMeaning] = useState(cue?.meaning ?? "");
  const [sentence, setSentence] = useState(cue?.sentence ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const kindLabel = useId();
  const pending = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function apply(remove: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (remove && cue) await library.remove(cue.id);
      else await library.save({
        id: cue?.id, kind, keyword: keyword.trim(), meaning: meaning.trim(), sentence: sentence.trim() || keyword.trim(),
      });
      if (active.current) close();
    } catch (failure) {
      if (active.current) setError(failure instanceof Error && failure.message ? failure.message : "预习内容暂未保存，请重试。");
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (keyword.trim()) void apply(false);
  }
  return <form onSubmit={submit}>
    <fieldset disabled={busy}>
      <div className="cue-fields">
        <label><span id={kindLabel}>类型</span><select aria-labelledby={kindLabel} value={kind}
          onChange={event => setKind(event.target.value as SceneCue["kind"])}>
          {Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>英文表达<input required maxLength={600} lang="en" value={keyword} onChange={event => setKeyword(event.target.value)} /></label>
      </div>
      <label>中文释义<input maxLength={400} value={meaning} placeholder="选填" onChange={event => setMeaning(event.target.value)} /></label>
      <label>例句<textarea rows={2} maxLength={600} value={sentence} placeholder="选填，留空会朗读英文表达" lang="en"
        onChange={event => setSentence(event.target.value)} /></label>
      <div className="cue-form-actions">
        <button type="submit" className="coaching-primary" disabled={busy || !keyword.trim()}>
          {!cue && <Plus size={15} />}{busy ? "正在保存…" : cue ? "保存修改" : "添加到预习"}
        </button>
        {cue && <button type="button" className="cue-text-action" onClick={() => void apply(true)}>移除这条</button>}
      </div>
    </fieldset>
    {error && <p role="alert" className="replay-error">{error}</p>}
  </form>;
}
