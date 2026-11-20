import { request, type CustomScene } from "./api";

export interface SceneCue {
  id: string;
  kind: "word" | "phrase" | "pattern";
  keyword: string;
  meaning: string;
  sentence: string;
}

export type CueDraft = Omit<SceneCue, "id"> & { id?: string };
export type CueChange = { action: "save"; cue: CueDraft } | { action: "remove"; id: string }
  | { action: "add_hint"; sentence: string; meaning?: string };
export interface CueScene { scenarioId: string; custom?: CustomScene }
export interface CueSnapshot { revision: number; cues: SceneCue[] | null }

function isCue(value: unknown): value is SceneCue {
  if (!value || typeof value !== "object") return false;
  const cue = value as Partial<SceneCue>;
  return typeof cue.id === "string" && (cue.kind === "word" || cue.kind === "phrase" || cue.kind === "pattern")
    && typeof cue.keyword === "string" && typeof cue.meaning === "string" && typeof cue.sentence === "string";
}

function snapshot(value: CueSnapshot): CueSnapshot {
  if (Number.isSafeInteger(value?.revision) && value.revision >= 0
    && (value.cues === null || (Array.isArray(value.cues) && value.cues.every(isCue)))) return value;
  throw new Error("预习表达的数据不完整，请重试。");
}

export async function readSceneCues({ scenarioId, custom }: CueScene, signal: AbortSignal): Promise<CueSnapshot> {
  const path = `/api/scene-cues/${encodeURIComponent(scenarioId)}`;
  const result = custom
    ? await request<CueSnapshot>(`${path}/lookup`, { method: "POST", body: JSON.stringify({ custom }), signal, cache: "no-store" })
    : await request<CueSnapshot>(path, { signal, cache: "no-store" });
  return snapshot(result);
}

export async function changeSceneCues({ scenarioId, custom }: CueScene, defaults: SceneCue[], change: CueChange): Promise<CueSnapshot> {
  const result = await request<CueSnapshot>(`/api/scene-cues/${encodeURIComponent(scenarioId)}`, {
    method: "PATCH", body: JSON.stringify({ ...change, defaults, custom }),
  });
  return snapshot(result);
}
