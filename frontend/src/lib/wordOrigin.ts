import { getScenario } from "../data/scenarios";
import type { CustomScene, WordCollectionOrigin } from "./api";

export function sceneWordOrigin(scenarioId?: string | null, custom?: CustomScene | null, previous?: string): WordCollectionOrigin | undefined {
  if (!scenarioId || (scenarioId !== "custom" && !getScenario(scenarioId))) return;
  const line = previous?.trim();
  return {
    scenario_id: scenarioId,
    ...(scenarioId === "custom" && custom ? { custom_scene: custom } : {}),
    ...(line ? { previous_partner_message: Array.from(line).slice(0, 800).join("") } : {}),
  };
}
