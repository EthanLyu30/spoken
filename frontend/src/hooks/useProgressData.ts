import { useEffect, useState, useSyncExternalStore } from "react";
import {
  getInsights,
  getPractice,
  getSession,
  getSessions,
  getStats,
} from "../lib/api";
import {
  progressGeneration,
  subscribeProgress,
  readProgressCache,
  writeProgressCache,
  type ProgressData,
} from "../lib/progressCache";

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
});

/** Independent sections: a slow report or analysis never hides readable history. */
export function useProgressData(owner: string) {
  const revision = useSyncExternalStore(
    subscribeProgress,
    progressGeneration,
    progressGeneration,
  );
  const [data, setData] = useState<ProgressData>(
    () => readProgressCache(owner) ?? empty(owner),
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const cached = attempt === 0 ? readProgressCache(owner) : undefined;
    const generation = progressGeneration();
    setData(
      (previous) =>
        cached ??
        (previous.owner === owner && previous.status === "ready"
          ? { ...previous, errors: [] }
          : empty(owner)),
    );
    const update = (patch: Partial<ProgressData>) => {
      if (controller.signal.aborted) return;
      setData((previous) => {
        if (previous.owner !== owner) return previous;
        const next = {
          ...previous,
          ...patch,
          errors: previous.errors.filter((part) => !(part in patch)),
        };
        writeProgressCache(owner, next, generation);
        return next;
      });
    };
    const failed = (part: string, patch: Partial<ProgressData> = {}) => {
      if (controller.signal.aborted) return;
      setData((previous) =>
        previous.owner === owner
          ? {
              ...previous,
              ...patch,
              errors: [...new Set([...previous.errors, part])],
            }
          : previous,
      );
    };
    const loadLatest = (id: number) =>
      getSession(id, controller.signal)
        .then((latest) => update({ latest }))
        .catch(() => failed("latest"));
    if (!cached)
      getSessions(controller.signal)
        .then((sessions) => {
          if (controller.signal.aborted) return;
          update({ sessions, status: "ready", latest: null });
          if (sessions.length) void loadLatest(sessions[0].id);
        })
        .catch(() => failed("sessions", { status: "error" }));
    else if (cached.sessions.length && !cached.latest)
      void loadLatest(cached.sessions[0].id);
    if (!cached?.stats)
      getStats(controller.signal)
        .then((stats) => update({ stats, statsPending: false }))
        .catch(() => failed("stats", { statsPending: false }));
    if (!cached || cached.practicePending || cached.errors.includes("practice"))
      getPractice(undefined, 100, controller.signal)
        .then((practice) => update({ practice, practicePending: false }))
        .catch(() => failed("practice", { practicePending: false }));
    if (!cached?.insights)
      getInsights(controller.signal)
        .then((insights) => update({ insights }))
        .catch(() => failed("insights"));
    return () => controller.abort();
  }, [owner, attempt, revision]);
  return {
    ...(data.owner === owner ? data : empty(owner)),
    reload: () => setAttempt((n) => n + 1),
  };
}
