import { useEffect, useState } from "react";
import {
  getPractice,
  getSessions,
  getStats,
  type PracticeRecord,
  type SessionSummary,
  type Stats,
} from "../lib/api";

interface ProfileData {
  owner: number | null;
  status: "loading" | "ready" | "error";
  sessions: SessionSummary[];
  practice: PracticeRecord[];
  stats: Stats | null;
}
const empty = (owner: number | null): ProfileData => ({
  owner,
  status: "loading",
  sessions: [],
  practice: [],
  stats: null,
});

/** Identity-keyed results prevent a previous account flashing while effects rerun. */
export function useProfileData(owner: number | null) {
  const [data, setData] = useState<ProfileData>(() => empty(owner));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(empty(owner));
    Promise.all([
      getSessions(controller.signal),
      getStats(controller.signal),
      getPractice(undefined, 100, controller.signal),
    ])
      .then(([sessions, stats, practice]) => {
        if (!controller.signal.aborted)
          setData({ owner, sessions, stats, practice, status: "ready" });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setData({ ...empty(owner), status: "error" });
      });
    return () => controller.abort();
  }, [owner, attempt]);
  return {
    ...(data.owner === owner ? data : empty(owner)),
    reload: () => setAttempt((n) => n + 1),
  };
}
