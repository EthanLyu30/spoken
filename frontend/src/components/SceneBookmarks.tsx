import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { useWords } from "../store/words";

interface Group {
  key: string;
  title: string;
  sentences: { id: string; sentence: string; meaning: string }[];
}

export function SceneBookmarks() {
  const collect = useWords(s => s.collect);
  const words = useWords(s => s.words);
  const saveError = useWords(s => s.error);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [generation, setGeneration] = useState(getAuthGeneration);
  useEffect(() => subscribeAuthGeneration(() => {
    setGroups(null);
    setError(false);
    setGeneration(getAuthGeneration());
  }), []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError(false);
    void request<Group[]>("/api/scene-cues", { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted && generation === getAuthGeneration()) setGroups(rows);
    }).catch(() => {
      if (!controller.signal.aborted && generation === getAuthGeneration()) setError(true);
    });
    return () => controller.abort();
  }, [open, attempt, generation]);

  return <details className="wordbag-scene-bookmarks" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>场景收藏</summary>
    {open && (error ? <p role="alert">场景收藏读取失败。 <button type="button" className="ui-link" onClick={() => setAttempt(n => n + 1)}>重试读取</button></p>
      : groups === null ? <p role="status">正在加载场景收藏…</p>
      : groups.length === 0 ? <p>在对话里收藏的提示句会按场景显示在这里。</p>
      : groups.map(group => <details key={group.key}>
        <summary>{group.title} · {group.sentences.length} 句</summary>
        <ul>{group.sentences.map(cue => {
          const exists = words.find(word => word.text === cue.sentence);
          const custom = group.key.startsWith("custom-");
          return <li key={cue.id}>
            <div><strong lang="en">{cue.sentence}</strong>{cue.meaning && <p>{cue.meaning}</p>}</div>
            <button type="button" className="ui-secondary" disabled={!!exists} onClick={() => collect({
              text: cue.sentence, meaning: cue.meaning, example: cue.sentence, kind: "sentence",
              scenario_id: custom ? "custom" : group.key, topic: Array.from(group.title).slice(0, 48).join(""),
              ...(custom ? { source: { key: group.key, title: group.title } } : {}),
            })}>{exists ? exists.id > 0 ? "已在生词本" : "正在加入…" : "加入复习"}</button>
          </li>;
        })}</ul>
      </details>))}
    {open && saveError && <p role="alert">部分收藏未能保存，可以重试加入。</p>}
  </details>;
}
