import { learningDay, statsMatchDay } from "../lib/learningDay";
import { useLearningDay } from "./useLearningDay";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getPractice,
  getProgressSessions,
  getStats,
} from "../lib/api";
import {
  progressGeneration,
  subscribeProgress,
  readProgressCache,
  discardProgressCache,
  writeProgressCache,
  type ProgressData,
} from "../lib/progressCache";

// Revisions are process-local and are excluded from serialized snapshots.
const statsRevision = Symbol("statsRevision");
const sessionsRevision = Symbol("sessionsRevision");
type ProgressSnapshot = ProgressData & { [statsRevision]?: number; [sessionsRevision]?: number };

const empty = (owner: string): ProgressData => ({
  owner,
  status: "loading",
  sessions: [],
  practice: [],
  stats: null,
  insights: null,
  latest: null,
  errors: [],
  practicePending: true,
  statsPending: true,
  sessionsPending: true,
  insightsPending: true,
});

/** Independent sections: a slow report or analysis never hides readable history. */
export function useProgressData(owner: string) {
  const day = useLearningDay();
  const revision = useSyncExternalStore(
    subscribeProgress,
    progressGeneration,
    progressGeneration,
  );
  const [data, setData] = useState<ProgressSnapshot>(
    () => readProgressCache(owner) ?? empty(owner),
  );
  const [statsDay, setStatsDay] = useState(day);
  const statsDayRef = useRef(day);
  const [attempt, setAttempt] = useState(0);
  const attempted = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const force = attempt !== attempted.current;
    attempted.current = attempt;
    const requestDay = learningDay();
    const cached = attempt === 0 ? readProgressCache(owner) : undefined;
    // A refresh can be abandoned before any response updates the cache.
    // Retain readable component state, but never leave an old complete entry.
    if (!cached) discardProgressCache(owner);
    const generation = progressGeneration();
    setData(
      (previous) =>
        (cached ? { ...cached, sessionsPending: true, practicePending: true, statsPending: true, insightsPending: true } : undefined) ??
        (previous.owner === owner
          ? { ...previous, status: previous.status === "error" ? "loading" : previous.status,
              stats: statsDayRef.current === requestDay ? previous.stats : null,
              errors: [], sessionsPending: true, practicePending: true, statsPending: true, insightsPending: true }
          : empty(owner)),
    );
    const current = () => !controller.signal.aborted && generation === progressGeneration();
    const update = (patch: Partial<ProgressSnapshot>) => {
      if (!current()) return;
      setData((previous) => {
        if (previous.owner !== owner || !current()) return previous;
        const next = {
          ...previous,
          ...patch,
          errors: previous.errors.filter((part) => !(part in patch)),
        };
        writeProgressCache(owner, next, generation, statsDayRef.current);
        return next;
      });
    };
    const failed = (part: string, patch: Partial<ProgressData> = {}) => {
      if (!current()) return;
      setData((previous) =>
        previous.owner === owner && current()
          ? {
              ...previous,
              ...patch,
              errors: [...new Set([...previous.errors, part, ...(part === "sessions" ? ["insights"] : [])])],
            }
          : previous,
      );
    };
    // Snapshot data is for immediate rendering only; the resource owns freshness.
    getProgressSessions(controller.signal, force)
      .then(({ sessions, insights, latest, correction_focus }) => {
        update({ sessions, insights, latest, correctionFocus: correction_focus, status: "ready", sessionsPending: false, insightsPending: false, [sessionsRevision]: generation });
      })
      .catch(() => failed("sessions", { status: "error", sessionsPending: false, insightsPending: false }));
    getStats(controller.signal, force)
      .then((stats) => { if (!current() || learningDay() !== requestDay) return; if (!statsMatchDay(stats, requestDay)) { failed("stats", { statsPending: false }); return; } statsDayRef.current = requestDay; setStatsDay(requestDay); update({ stats, statsPending: false, [statsRevision]: generation }); })
      .catch(() => failed("stats", { statsPending: false }));
    getPractice(undefined, 100, controller.signal, force)
      .then((practice) => update({ practice, practicePending: false }))
      .catch(() => failed("practice", { practicePending: false }));
    return () => controller.abort();
  }, [owner, attempt, revision, day]);

  function forgetHistoryRecord(collection: "sessions" | "practice", id: number, createdAt: string) {
    const revision = progressGeneration();
    // A concurrent section may already have cached a mixed snapshot after invalidation.
    discardProgressCache(owner);
    setData((previous) => {
      if (previous.owner !== owner) return previous;
      const hasDifferentIdentity = (record: { id: number; created_at: string }) =>
        record.id !== id || record.created_at !== createdAt;
      const updated: ProgressSnapshot = {
        ...previous,
        stats: previous[statsRevision] === revision ? previous.stats : null,
        [collection]: previous[collection].filter(hasDifferentIdentity),
        ...(collection === "sessions" && previous[sessionsRevision] !== revision
          ? { insights: null, latest: null, correctionFocus: undefined }
          : {}),
      };
      writeProgressCache(owner, updated, revision, statsDayRef.current);
      return updated;
    });
  }

  return {
    ...(data.owner === owner ? (statsDay === day ? data : { ...data, stats: null }) : empty(owner)),
    reload: () => setAttempt((n) => n + 1),
    forgetHistoryRecord,
  };
}
