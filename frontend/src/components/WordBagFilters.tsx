import { Check, Search, SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ReviewMode } from "../lib/wordReview";

const modes: Record<ReviewMode, string> = { flip: "翻卡回忆", translate: "看中文写英文", cloze: "关键词填空" };
const levels = { "": "全部熟悉度", new: "待学习", familiar: "熟悉", uncertain: "模糊", forgot: "遗忘" };

export function WordBagFilters({ topics, topic, familiarity, mode, onTopic, onFamiliarity, onMode }: {
  topics: string[];
  topic: string;
  familiarity: string;
  mode: ReviewMode;
  onTopic: (next: string) => void;
  onFamiliarity: (next: string) => void;
  onMode: (next: ReviewMode) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const candidates = topic && !topics.includes(topic) ? [topic, ...topics] : topics;
  const searchable = candidates.length > 6;
  const query = searchable ? search.trim().toLocaleLowerCase() : "";
  const shown = candidates.filter(name => name.toLocaleLowerCase().includes(query));
  const applied = Number(Boolean(topic)) + Number(Boolean(familiarity));

  return <div className="wordbag-filters" onKeyDown={event => {
    if (!expanded || event.key !== "Escape") return;
    event.stopPropagation();
    setExpanded(false);
    trigger.current?.focus();
  }}>
    <button ref={trigger} type="button" className="wordbag-filter-trigger" aria-controls={expanded ? id : undefined}
      aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <SlidersHorizontal size={16} aria-hidden="true" /> 筛选与题型{applied > 0 && <span>{applied}</span>}
    </button>
    {expanded && <div className="wordbag-filter-panel" id={id}>
      <div className="wordbag-filter-group" role="group" aria-label="话题">
        <span>话题</span>
        {searchable && <div className="wordbag-filter-search">
          <Search size={16} aria-hidden="true" /><input value={search} onChange={event => setSearch(event.target.value)}
            aria-label="查找话题" placeholder="查找话题" />
        </div>}
        <div className="wordbag-choice-strip">
          <button type="button" aria-pressed={!topic} onClick={() => { onTopic(""); setSearch(""); }}>全部话题</button>
          {shown.map(name => <button key={name} type="button" aria-pressed={name === topic} onClick={() => onTopic(name)}>
            {name === topic && <Check size={14} aria-hidden="true" />}{name}
          </button>)}
          {query && !shown.length && <p>没有匹配的话题。</p>}
        </div>
      </div>
      <div className="wordbag-filter-group" role="group" aria-label="熟悉度">
        <span>熟悉度</span>
        <div className="wordbag-choice-strip">
          {Object.entries(levels).map(([key, label]) => <button key={key} type="button" aria-pressed={key === familiarity}
            onClick={() => onFamiliarity(key)}>{label}</button>)}
        </div>
      </div>
      <div className="wordbag-filter-group" role="group" aria-label="复习方式">
        <span>复习方式</span>
        <div className="wordbag-choice-strip">
          {(Object.keys(modes) as ReviewMode[]).map(key => <button key={key} type="button" aria-pressed={key === mode}
            onClick={() => onMode(key)}>{modes[key]}</button>)}
        </div>
      </div>
    </div>}
  </div>;
}
