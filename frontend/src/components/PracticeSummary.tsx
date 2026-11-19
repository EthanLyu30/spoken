import type { ReactNode } from "react";

export function PracticeSummary({ scene, summary, score, children }: {
  scene?: string; summary: string; score: number | null; children: ReactNode;
}) {
  return <header className="practice-summary">
    <div>
      <p className="practice-summary-scene">课后小结{scene && ` · ${scene}`}</p>
      <h1>{summary}</h1>
      <p className="practice-summary-meta">{children}</p>
    </div>
    {score === null ? <span className="report-score">未评分</span>
      : <div className="report-score"><strong>{score}</strong><span>/ 100 · 练习参考分</span></div>}
  </header>;
}
