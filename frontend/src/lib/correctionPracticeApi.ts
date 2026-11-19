import { request } from "./api";
import type { TranslationExercise } from "./correctionDrill";

export interface PracticeResult {
  correct: boolean;
  feedback: string;
}

export function translateCorrection(exercise: TranslationExercise, signal: AbortSignal) {
  return request<{ chinese: string }>("/api/correction-practice/translation", {
    method: "POST", body: JSON.stringify(exercise), signal,
  }, 22_000);
}

export function checkCorrectionTranslation(exercise: TranslationExercise, chinese: string, attempt: string, signal: AbortSignal) {
  return request<PracticeResult>("/api/correction-practice/check", {
    method: "POST", body: JSON.stringify({ ...exercise, chinese, attempt }), signal,
  }, 22_000);
}
