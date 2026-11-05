/** Keep missing measurements distinct from zero and tiny positive charges. */
export function referenceCost(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return '—';
  const amount = (value: number) => value > 0 && value < .0001 ? '<0.0001' : value === 0 ? '0' : value.toFixed(4);
  const a = amount(min), b = amount(max);
  return `¥${a === b ? a : `${a}–${b}`}`;
}


import type { AdminTrace } from "./adminApi";

const dataOperations = new Set(['GET /api/stats', 'GET /api/words', 'GET /api/sessions', 'GET /api/practice', 'GET /api/interview/sets', 'GET /api/progress/sessions', 'GET /api/sessions/{session_id}']);
const voiceOperation = /(^|\/)(asr|pronunciation|tts)(\/|$)/i;
const modelOperations = /(?:^|\/)(chat|feedback|hint|turn-correction|custom-scenario|scenario-suggestion|dictionary\/lookup|interview\/score|interview\/questions)(?:\/|$)/i;
const dataDeleteOperations = new Set(['DELETE /api/words/{word_id}']);

/** Explain the model column without pretending reads/voice/writes have a model. */
export function modelLabel(trace: AdminTrace): string {
  if (trace.model && !trace.model.startsWith('unknown') && !trace.model.startsWith('browser/')) return trace.model;
  if (trace.source === 'browser') return '浏览器端';
  if (trace.operation === 'GET /api/scenario-suggestion') return 'AI 场景生成';
  if (dataOperations.has(trace.operation) || trace.operation.startsWith('GET /api/')) return '数据读取';
  if (voiceOperation.test(trace.operation)) return '语音引擎';
  if (trace.operation === 'POST /api/sessions' || trace.operation === 'POST /api/practice') return '数据写入';
  if (dataDeleteOperations.has(trace.operation)) return '数据删除';
  if (modelOperations.test(trace.operation)) return 'AI 调用未记录';
  return '非模型调用';
}
