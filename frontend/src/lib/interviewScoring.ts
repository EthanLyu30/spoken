/** Text-observable paraphrases of ETS Take an Interview anchors, checked 2026-10-30. */
export const interviewRubricUrl = "https://www.ets.org/content/dam/ets-org/pdfs/toefl/speaking-rubrics.pdf";
export const interviewRubric = [
  { score: 5, description: "完整切题，理由或例子展开充分；组织清楚，语言准确、表达精确且有适当变化。" },
  { score: 4, description: "切题并有相关支持，意思清楚；展开、连接或语言的精确性仍有少量不足。" },
  { score: 3, description: "总体相关，但展开有限或部分题意未充分回应；语言范围或错误限制表达。" },
  { score: 2, description: "仅作出简单回应，多为重复题意、零散主张；支持很少，语言限制明显。" },
  { score: 1, description: "只有少数相关词或片段，尚未形成有意义的回答。" },
  { score: 0, description: "没有回答、没有英语、完全离题，或只有“不知道”等未作答表达。" },
] as const;

export function interviewScoreMax(result: { score_max?: number; scoring_version?: string }): 5 | 6 {
  return result.score_max === 5 && result.scoring_version === "ets-interview-text-v1" ? 5 : 6;
}

export function interviewProgressSummary(records: { score: number; score_max?: number }[]) {
  const current = records.filter((record) => record.score_max === 5);
  const source = current.length ? current : records;
  return {
    average: source.length ? Math.round(source.reduce((sum, record) => sum + record.score, 0) / source.length * 10) / 10 : null,
    scale: current.length || !records.length ? 5 : 6,
    count: source.length,
    legacyCount: records.length - current.length,
  };
}
