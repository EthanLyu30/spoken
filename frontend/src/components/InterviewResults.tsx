import { useEffect, useState } from "react";
import { ArrowRight, ExternalLink, RotateCcw, Volume2 } from "lucide-react";
import type { InterviewScore } from "../lib/api";
import { speakText, stopSpeaking } from "../lib/speech";
import { Buddy } from "./Buddy";
import { interviewRubric, interviewRubricUrl, interviewScoreMax } from "../lib/interviewScoring";

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
  const scoreMax = interviewScoreMax(result);
  const wordCount = current?.sample_word_count ?? (current?.sample_answer.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)?.length ?? 0);
  const estimatedSeconds = current?.sample_estimated_seconds ?? Math.round(wordCount / 110 * 60 + 4);
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
          <h2>{scoreMax === 5 ? "内容参考分" : "旧版练习参考分"}</h2>
          <p>{scoreMax === 5 ? "按 ETS Interview 文本适用标准评估；未评估发音、停顿和流利度，不等同官方成绩。" : "此记录基于转写内容，保留旧版 0–6 分制，未重新评分；不与新版均分混算。"}</p>
        </div>
        <strong>
          {result.overall}
          <small> / {scoreMax}</small>
        </strong>
      </section>
      {scoreMax === 5 && <details className="interview-rubric">
        <summary>查看 0–5 分评分标准</summary>
        <p>以下为官方标准中可从文本观察的部分的中文释义；每题取整数分，上方显示四题均分。</p>
        <dl>{interviewRubric.map((band) => <div key={band.score}><dt>{band.score} 分</dt><dd>{band.description}</dd></div>)}</dl>
        <p>不以固定词数、复杂词汇数量或与视频相同的立场评分。短而完整可以得高分。</p>
        <a href={interviewRubricUrl} target="_blank" rel="noopener noreferrer">ETS 官方评分标准 <ExternalLink size={13} /></a>
      </details>}
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
                  <div className="sample-answer-heading">
                    <h3>参考表达</h3>
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
                    {current.sample_source === "video_reference" ? "参考思路 · AI 改写" : "AI 口语示例"}
                  </p>
                  <p>{current.sample_answer}</p>
                  {current.reference_notes && (
                    <div className="sample-reference-notes">
                      <h4>参考思路要点</h4>
                      <p>{current.reference_notes}</p>
                    </div>
                  )}
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
              onClick={() => {
                if (selected !== i) setSelected(i);
              }}
            >
              <span>
                第 {i + 1} 题<small>{r.level}</small>
              </span>
              <strong>
                {r.score}
                <small> / {scoreMax}</small>
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
