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
const PREFIX = "spoken-progress-v1:";
// A hard reload has no module memory; keep the last successful snapshot long
// enough to paint immediately, then let the hook revalidate it in the background.
const READ_TTL = 5 * 60_000;
let generation = 0;
const listeners = new Set<() => void>();
export function subscribeProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function storageKey(owner: string): string {
  return PREFIX + owner;
}
function readStored(owner: string): { at: number; day: string; data: ProgressData } | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey(owner)) ?? "null") as
      | { at?: number; day?: string; data?: ProgressData }
      | null;
    if (!parsed || parsed.data?.owner !== owner || typeof parsed.at !== "number" || typeof parsed.day !== "string") return undefined;
    return { at: parsed.at, day: parsed.day, data: parsed.data };
  } catch {
    return undefined;
  }
}
export function invalidateProgress(): void {
  cache.clear();
  generation++;
  try {
    if (typeof sessionStorage !== "undefined") {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
      }
    }
  } catch {
    /* storage may be unavailable; the in-memory generation still invalidates */
  }
  listeners.forEach((listener) => listener());
}
export function progressGeneration(): number {
  return generation;
}
export function readProgressCache(owner: string): ProgressData | undefined {
  const hit = cache.get(owner) ?? readStored(owner);
  if (!hit) return undefined;
  if (Date.now() - hit.at >= READ_TTL) {
    discardProgressCache(owner);
    return undefined;
  }
  return hit.day === learningDay() ? hit.data : { ...hit.data, stats: null, statsPending: true };
}
export function discardProgressCache(owner: string): void {
  cache.delete(owner);
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(storageKey(owner));
  } catch {
    /* optional cache */
  }
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
  const entry = { at: Date.now(), day: statsDay, data };
  cache.set(owner, entry);
  try {
    if (typeof sessionStorage !== "undefined")
      sessionStorage.setItem(storageKey(owner), JSON.stringify(entry));
  } catch {
    /* quota/private mode: keep the in-memory snapshot only */
  }
}
