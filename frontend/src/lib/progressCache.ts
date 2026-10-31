import { learningDay } from "./learningDay";
import type {
  Insights,
  PracticeRecord,
  ProgressSessions,
  SessionSummary,
  Stats,
} from "./api";

export interface ProgressData {
  owner: string;
  status: "loading" | "ready" | "error";
  sessions: SessionSummary[];
  practice: PracticeRecord[];
  stats: Stats | null;
  insights: Insights | null;
  latest: ProgressSessions["latest"];
  errors: string[];
  practicePending: boolean;
  statsPending: boolean;
  sessionsPending: boolean;
  insightsPending: boolean;
}
const cache = new Map<string, { at: number; day: string; data: ProgressData }>();
let generation = 0;
const listeners = new Set<() => void>();
export function subscribeProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function invalidateProgress(): void {
  cache.clear();
  generation++;
  listeners.forEach((listener) => listener());
}
export function progressGeneration(): number {
  return generation;
}
export function readProgressCache(owner: string): ProgressData | undefined {
  const hit = cache.get(owner);
  return hit && Date.now() - hit.at < 30_000 ? (hit.day === learningDay() ? hit.data : { ...hit.data, stats: null, statsPending: true }) : undefined;
}
export function discardProgressCache(owner: string): void {
  cache.delete(owner);
}
export function writeProgressCache(
  owner: string,
  data: ProgressData,
  expectedGeneration: number,
  statsDay: string,
): void {
  if (expectedGeneration !== generation || data.status !== "ready") return;
  if (!cache.has(owner) && cache.size >= 4)
    cache.delete(cache.keys().next().value!);
  cache.set(owner, { at: Date.now(), day: statsDay, data });
}
