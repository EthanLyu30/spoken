import { useEffect, useState } from "react";
import { ArrowRight, RotateCcw, Volume2 } from "lucide-react";
import type { InterviewScore } from "../lib/api";
import { speakText, stopSpeaking } from "../lib/speech";
import { Buddy } from "./Buddy";

function videoReferenceUrl(source?: string | null): string | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const videoId = "[A-Za-z0-9_-]{11}";
    if (url.hostname === "youtu.be" && new RegExp(`^/${videoId}/?$`).test(url.pathname)) return source;
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return null;
    if (url.pathname === "/watch" && new RegExp(`^${videoId}$`).test(url.searchParams.get("v") ?? "")) return source;
    if (new RegExp(`^/(shorts|embed)/${videoId}/?$`).test(url.pathname)) return source;
  } catch {
    // Old saved records may contain an invalid source URL.
  }
  return null;
}

export function InterviewResults({
  result,
  onRestart,
  onExit,
  exitLabel = "回首页",
}: {
  result: InterviewScore;
  onRestart: () => void;
  onExit: () => void;
  exitLabel?: string;
}) {
  const [selected, setSelected] = useState(0);
  useEffect(() => () => stopSpeaking(), [selected]);
  const current = result.results[selected];
  const wordCount = current?.sample_word_count ?? (current?.sample_answer.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0);
  const estimatedSeconds = current?.sample_estimated_seconds ?? Math.round(wordCount / 110 * 60 + 4);
  const sourceUrl = current?.sample_source === "video_reference" ? videoReferenceUrl(current.sample_source_url) : null;
  return (
    <div className="interview-results">
      <div className="ui-page-head">
        <div>
          <p className="eyebrow">TAKE AN INTERVIEW · YOUR REVIEW</p>
          <h1>把这次的表达，变成下次的底气。</h1>
          <p>回看表达，积累下一次能用上的说法。</p>
        </div>
        <button type="button" className="ui-button" onClick={onRestart}>
          <RotateCcw />
          再练一组
        </button>
      </div>
      <section className="interview-overall">
        <Buddy size={65} />
        <div>
          <h2>练习参考分</h2>
          <p>基于转写内容评估语言与内容组织；不包含发音评测。</p>
        </div>
        <strong>
          {result.overall}
          <small> / 6</small>
        </strong>
      </section>
      <div className="interview-review-grid">
        <div>
          {current && (
            <section className="interview-answer">
              <p className="eyebrow">
                QUESTION {String(selected + 1).padStart(2, "0")}
              </p>
              <h2>{current.question}</h2>
              <div className="answer-columns">
                <div>
                  <h3>你的回答</h3>
                  <p>{current.answer || "（没有录到回答）"}</p>
                  <div className="answer-feedback">
                    <h3>Pip 的建议</h3>
                    <p>{current.feedback}</p>
                  </div>
                </div>
                <div className="sample-answer">
                  <div>
                    <h3>参考表达 · Sample</h3>
                    <button
                      type="button"
                      onClick={() => speakText(current.sample_answer)}
                      aria-label="朗读范例"
                    >
                      <Volume2 />
                    </button>
                  </div>
                  <p className="sample-answer-meta">{wordCount} 词 · 约 {estimatedSeconds} 秒</p>
                  <p className="sample-answer-source">
                    {sourceUrl ? (
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">参考视频思路 · AI 改写</a>
                    ) : "AI 口语示例"}
                  </p>
                  <p>{current.sample_answer}</p>
                  <p className="sample-answer-estimate">按约 110 词/分钟，加 4 秒停顿估算；实际用时因人而异。</p>
                </div>
              </div>
            </section>
          )}
        </div>
        <aside className="interview-question-list">
          <h2>四题回顾</h2>
          {result.results.map((r, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={selected === i}
              onClick={() => setSelected(i)}
            >
              <span>
                第 {i + 1} 题<small>{r.level}</small>
              </span>
              <strong>
                {r.score}
                <small> / 6</small>
              </strong>
            </button>
          ))}
          <p>分数用于本次练习参考，逐题回看建议更能帮助你进步。</p>
        </aside>
      </div>
      <div className="interview-bottom">
        <button type="button" className="ui-secondary" onClick={onExit}>
          {exitLabel}
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}
