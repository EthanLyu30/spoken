import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, Shuffle } from "lucide-react";
import type { InterviewCollection, InterviewSetSummary } from "../lib/api";

const PAGE_SIZE = 6;
const labels = { inspire: "博主系列", ets: "ETS 公开样题" };

export function InterviewLibrary({
  sets,
  source,
  onSourceChange,
  selected,
  onSelect,
  loading,
  error,
}: {
  sets: InterviewSetSummary[];
  source: InterviewCollection;
  onSourceChange: (source: InterviewCollection) => void;
  selected: string;
  onSelect: (id: string) => void;
  loading: boolean;
  error: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const sourceSets = sets.filter((entry) => entry.collection === source);
  const counts = {
    inspire: sets.filter((entry) => entry.collection === "inspire").length,
    ets: sets.filter((entry) => entry.collection === "ets").length,
  };
  function matching(search: string) {
    const normalized = search.trim().toLowerCase();
    const episode = normalized.match(/^(?:#|第)?\s*(\d+)\s*期?$/);
    return sourceSets.filter((entry) =>
      episode
        ? entry.episode === Number(episode[1])
        : `${entry.topic} ${entry.topic_en}`.toLowerCase().includes(normalized),
    );
  }
  const results = matching(query);
  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = results.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selectionVisible = visible.some((entry) => entry.id === selected);

  useEffect(() => {
    if (selected && !selectionVisible) onSelect("");
  }, [selected, selectionVisible, onSelect]);

  function changeSource(next: InterviewCollection) {
    setQuery("");
    setPage(1);
    onSelect("");
    onSourceChange(next);
  }
  function changeQuery(next: string) {
    setQuery(next);
    setPage(1);
    if (!matching(next).slice(0, PAGE_SIZE).some((entry) => entry.id === selected))
      onSelect("");
  }
  function changePage(next: number) {
    setPage(next);
    onSelect("");
  }
  return (
    <div className="interview-library">
      <div
        className="interview-collections"
        role="group"
        aria-label="选择题库来源"
      >
        {(["inspire", "ets"] as const).map((collection) => (
          <button
            key={collection}
            aria-pressed={source === collection}
            onClick={() => changeSource(collection)}
          >
            {labels[collection]}
            <span>{loading || error ? "—" : `${counts[collection]} 组`}</span>
          </button>
        ))}
      </div>
      <label className="interview-library-search">
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索访谈主题或期数"
          placeholder="搜索中文 / English / #期数"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
        />
      </label>
      <p className="interview-library-count" aria-live="polite">
        {loading
          ? "正在读取题库…"
          : error
            ? "题库暂时未能加载"
            : query.trim()
              ? `找到 ${results.length} 组 · ${labels[source]}共 ${sourceSets.length} 组`
              : `${labels[source]} · ${sourceSets.length} 组同主题访谈`}
      </p>
      <div
        className="interview-topic-grid"
        role="group"
        aria-label="选择访谈主题"
      >
        <button
          aria-pressed={!selected}
          disabled={loading || error || !sourceSets.length}
          onClick={() => onSelect("")}
        >
          <Shuffle />
          <strong>随机一组</strong>
          <small>从{labels[source]}随机抽取</small>
        </button>
        {visible.map((entry, i) => (
          <button
            key={entry.id}
            aria-pressed={selected === entry.id}
            onClick={() => onSelect(entry.id)}
          >
            <span className="interview-topic-number">
              {entry.episode
                ? `#${entry.episode}`
                : String((currentPage - 1) * PAGE_SIZE + i + 1).padStart(2, "0")}
            </span>
            <strong>{entry.topic}</strong>
            <small>{entry.topic_en}</small>
            <span className="interview-topic-source">
              {entry.collection === "inspire" ? "Inspire SpeakEasy" : "ETS 公开样题"}
            </span>
            {selected === entry.id && (
              <Check className="topic-selected" size={15} />
            )}
          </button>
        ))}
      </div>
      {!loading && !error && !results.length && (
        <div className="interview-library-empty" role="status">
          <p>
            {sourceSets.length
              ? "没有找到匹配的主题，试试其他关键词，或直接随机开始。"
              : "这一来源暂无可用题组，可以切换来源继续练习。"}
          </p>
          {sourceSets.length ? (
            <button onClick={() => changeQuery("")}>清除搜索</button>
          ) : (
            <button
              onClick={() => changeSource(source === "inspire" ? "ets" : "inspire")}
            >
              切换到 {labels[source === "inspire" ? "ets" : "inspire"]}
            </button>
          )}
        </div>
      )}
      {!loading && !error && results.length > 0 && (
        <nav
          className="interview-library-pagination"
          aria-label="访谈题库分页"
        >
          <button
            aria-label="上一页"
            disabled={currentPage === 1}
            onClick={() => changePage(currentPage - 1)}
          >
            <ChevronLeft size={16} />上一页
          </button>
          <span aria-live="polite">第 {currentPage} / {pageCount} 页</span>
          <button
            aria-label="下一页"
            disabled={currentPage === pageCount}
            onClick={() => changePage(currentPage + 1)}
          >
            下一页<ChevronRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
