import type { PracticeRecord, SessionSummary, Stats } from "./api";
import { learningDay } from "./learningDay";

/** Last successful profile snapshot; stale data paints first, then revalidates. */
export interface ProfileSnapshot {
  owner: number | null;
  at: number;
  day: string;
  sessions: SessionSummary[];
  practice: PracticeRecord[];
  stats: Stats | null;
}
const PREFIX = "spoken-profile-v1:";
const TTL = 5 * 60_000;

function key(owner: number | null): string {
  return PREFIX + (owner === null ? "guest" : String(owner));
}

export function readProfileCache(owner: number | null): ProfileSnapshot | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key(owner)) ?? "null") as
      | Partial<ProfileSnapshot>
      | null;
    if (
      !parsed ||
      parsed.owner !== owner ||
      typeof parsed.at !== "number" ||
      typeof parsed.day !== "string" ||
      !Array.isArray(parsed.sessions) ||
      !Array.isArray(parsed.practice)
    )
      return undefined;
    if (Date.now() - parsed.at >= TTL) {
      sessionStorage.removeItem(key(owner));
      return undefined;
    }
    return {
      owner,
      at: parsed.at,
      day: parsed.day,
      // Stats are day-scoped; keep history readable across midnight but do not
      // present yesterday's goal/streak as today's.
      stats: parsed.day === learningDay() ? (parsed.stats ?? null) : null,
      sessions: parsed.sessions,
      practice: parsed.practice,
    };
  } catch {
    return undefined;
  }
}

export function writeProfileCache(
  owner: number | null,
  values: Pick<ProfileSnapshot, "sessions" | "practice" | "stats">,
  day = learningDay(),
): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const entry: ProfileSnapshot = {
      owner,
      at: Date.now(),
      day,
      sessions: values.sessions,
      practice: values.practice,
      stats: values.stats,
    };
    sessionStorage.setItem(key(owner), JSON.stringify(entry));
  } catch {
    /* quota/private mode: the next request still renders normally */
  }
}
