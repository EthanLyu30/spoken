import { useState } from "react";
import { ArrowRight, RotateCcw, Volume2 } from "lucide-react";
import type { InterviewScore } from "../lib/api";
import { speakText } from "../lib/speech";
import { Buddy } from "./Buddy";

export function InterviewResults({
  result,
  onRestart,
  onExit,
}: {
  result: InterviewScore;
  onRestart: () => void;
  onExit: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const current = result.results[selected];
  return (
    <div className="interview-results">
      <div className="ui-page-head">
        <div>
          <p className="eyebrow">TAKE AN INTERVIEW · YOUR REVIEW</p>
          <h1>这次的回答，更有条理了</h1>
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
                    <h3>高分范例 · Sample</h3>
                    <button
                      type="button"
                      onClick={() => speakText(current.sample_answer)}
                      aria-label="朗读范例"
                    >
                      <Volume2 />
                    </button>
                  </div>
                  <p>{current.sample_answer}</p>
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
          回首页
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}
