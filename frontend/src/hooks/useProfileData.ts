import { learningDay, statsMatchDay } from "../lib/learningDay";
import { useLearningDay } from "./useLearningDay";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { subscribeProgress, progressGeneration } from "../lib/progressCache";
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
  errors: string[];
  pending: string[];
}
const empty = (owner: number | null): ProfileData => ({
  owner,
  status: "loading",
  sessions: [],
  practice: [],
  stats: null,
  errors: [],
  pending: ["sessions", "stats", "practice"],
});

/** Identity-keyed results prevent a previous account flashing while effects rerun. */
export function useProfileData(owner: number | null, details = true) {
  const day = useLearningDay();
  const [statsDay, setStatsDay] = useState(day);
  const revision = useSyncExternalStore(subscribeProgress, progressGeneration, progressGeneration);
  const [data, setData] = useState<ProfileData>(() => empty(owner));
  const [attempt, setAttempt] = useState(0);
  const attempted = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const force = attempt !== attempted.current;
    attempted.current = attempt;
    const requestDay = learningDay();
    const sections = details ? ["sessions", "stats", "practice"] : ["stats"];
    setData(previous => ({...(previous.owner === owner && previous.status === "ready" ? previous : empty(owner)),pending:sections,errors:[]}));
    const complete = (part:string, patch:Partial<ProfileData>, failed=false) => {
      if (controller.signal.aborted) return;
      setData(previous => {
        if (previous.owner !== owner) return previous;
        const pending=previous.pending.filter(section=>section !== part);
        const errors=[...previous.errors.filter(section=>section !== part),...(failed ? [part] : [])];
        const readable=previous.status === "ready" || sections.some(section=>!pending.includes(section) && !errors.includes(section));
        return {...previous,...patch,pending,errors,status:readable ? "ready" : pending.length ? "loading" : "error"};
      });
    };
    void getStats(controller.signal, force).then(stats=>{ if (learningDay() !== requestDay) return; if (!statsMatchDay(stats, requestDay)) { complete("stats",{},true); return; } setStatsDay(requestDay); complete("stats",{stats}); }).catch(()=>complete("stats",{},true));
    if (details) {
      void getSessions(controller.signal, force).then(sessions=>complete("sessions",{sessions})).catch(()=>complete("sessions",{},true));
      void getPractice(undefined,100,controller.signal, force).then(practice=>complete("practice",{practice})).catch(()=>complete("practice",{},true));
    }
    return () => controller.abort();
  }, [owner, attempt, revision, details, day]);
  return {
    ...(data.owner === owner ? (statsDay === day ? data : {...data, stats: null}) : empty(owner)),
    reload: () => setAttempt((n) => n + 1),
  };
}
