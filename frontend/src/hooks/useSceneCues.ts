import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { defaultSceneCues } from "../data/practiceCues";
import type { CustomScene } from "../lib/api";
import { assertAuthGeneration, getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { getClientId } from "../lib/clientId";
import { changeSceneCues, readSceneCues, type CueChange, type CueDraft, type CueScene, type CueSnapshot } from "../lib/sceneCuesApi";

export type { SceneCue } from "../lib/sceneCuesApi";

interface Scope {
  key: string;
  generation: number;
  scene: CueScene;
}
interface View { scope: Scope; snapshot?: CueSnapshot; error?: string }

// A save can finish after the conversation has navigated back to prep. Notify the
// mounted view of that scene, while retaining no learner records between visits.
const listeners = new Set<(scope: Scope, saved: CueSnapshot) => void>();

function describeScene(scene: CustomScene) {
  // Reopened sessions can reorder fields, add null targets and change the display-only source.
  return JSON.stringify({
    title: scene.title, title_zh: scene.title_zh ?? "", partner_role: scene.partner_role, goal: scene.goal,
    persona: scene.persona, opening_line: scene.opening_line,
    practice_cues: (scene.practice_cues ?? []).map(({ keyword, meaning, sentence }) => ({ keyword, meaning, sentence })),
    practice_exercises: scene.practice_exercises?.length ? scene.practice_exercises.map(exercise => ({
      partner_line: exercise.partner_line, task: exercise.task, hint: exercise.hint, example: exercise.example,
      target: exercise.target ? {
        kind: exercise.target.kind, instruction: exercise.target.instruction,
        form: exercise.target.form ?? "", context: exercise.target.context ?? "",
      } : null,
    })) : undefined,
  });
}

export function useSceneCues(scenarioId: string, custom?: CustomScene | null) {
  const generation = useSyncExternalStore(subscribeAuthGeneration, getAuthGeneration, getAuthGeneration);
  const descriptor = useMemo(() => scenarioId === "custom" && custom ? describeScene(custom) : "", [scenarioId, custom]);
  const scope = useMemo<Scope>(() => ({
    key: descriptor || scenarioId, generation,
    scene: { scenarioId, custom: descriptor ? JSON.parse(descriptor) as CustomScene : undefined },
  }), [scenarioId, descriptor, generation]);
  const defaults = useMemo(() => defaultSceneCues(scope.scene.scenarioId, scope.scene.custom), [scope]);
  const available = !!scenarioId && (scenarioId !== "custom" || !!descriptor);
  const active = useRef<Scope | null>(null);
  const [view, setView] = useState<View>();
  const [attempt, setAttempt] = useState(0);
  const accept = useCallback((snapshot: CueSnapshot) => {
    setView(previous => previous?.scope === scope && previous.snapshot && previous.snapshot.revision > snapshot.revision
      ? previous : { scope, snapshot });
  }, [scope]);

  useLayoutEffect(() => {
    active.current = scope;
    const receive = (source: Scope, saved: CueSnapshot) => {
      if (source.generation === scope.generation && source.key === scope.key) accept(saved);
    };
    listeners.add(receive);
    return () => { active.current = null; listeners.delete(receive); };
  }, [scope, accept]);

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && active.current === scope && scope.generation === getAuthGeneration();
    readSceneCues(scope.scene, controller.signal).then(snapshot => {
      if (current()) accept(snapshot);
    }).catch(() => {
      if (current()) setView(previous => previous?.scope === scope && previous.snapshot
        ? previous : { scope, error: "个人预习暂时无法加载，请重试。" });
    });
    return () => controller.abort();
  }, [scope, available, attempt, accept]);

  const mutate = useCallback(async (change: CueChange) => {
    // Reconcile a rotated guest id before the API captures credentials for this write.
    getClientId();
    assertAuthGeneration(scope.generation);
    if (active.current !== scope) throw new DOMException("Scene changed", "AbortError");
    if (!available) throw new Error("请先选择练习场景。");
    const saved = await changeSceneCues(scope.scene, defaults, change);
    assertAuthGeneration(scope.generation);
    for (const listener of listeners) listener(scope, saved);
    if (active.current !== scope) throw new DOMException("Scene changed", "AbortError");
  }, [scope, defaults, available]);
  const retry = useCallback(() => {
    setView(previous => previous?.scope === scope ? { ...previous, error: undefined } : previous);
    setAttempt(value => value + 1);
  }, [scope]);
  const current = view?.scope === scope ? view : undefined;
  return {
    cues: current?.snapshot?.cues ?? defaults,
    ready: !!current?.snapshot,
    error: current?.error ?? null,
    retry,
    save: (cue: CueDraft) => mutate({ action: "save", cue }),
    remove: (id: string) => mutate({ action: "remove", id }),
    addHint: (sentence: string) => mutate({ action: "add_hint", sentence }),
  };
}
