import { useEffect, useState, useSyncExternalStore } from "react";
import { getCoaching, type CoachingSnapshot, type CustomScene } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { progressGeneration, subscribeProgress } from "../lib/progressCache";

export function useCoachingSnapshot(scene?: string, custom?: CustomScene | null) {
  const generation = useSyncExternalStore(subscribeAuthGeneration, getAuthGeneration, getAuthGeneration);
  const progress = useSyncExternalStore(subscribeProgress, progressGeneration, progressGeneration);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ generation: number; progress: number; attempt: number; scene?: string;
    custom?: CustomScene | null; snapshot?: CoachingSnapshot; error?: true }>();
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration() && progress === progressGeneration();
    getCoaching(controller.signal, scene, custom).then((snapshot) => {
      if (current()) setState({ generation, progress, attempt, scene, custom, snapshot });
    }).catch(() => {
      if (current()) setState({ generation, progress, attempt, scene, custom, error: true });
    });
    return () => controller.abort();
  }, [scene, custom, generation, progress, attempt]);
  const current = state?.generation === generation && state.progress === progress && state.attempt === attempt &&
    state.scene === scene && state.custom === custom ? state : undefined;
  return { snapshot: current?.snapshot, error: current?.error, retry: () => setAttempt((value) => value + 1) };
}
