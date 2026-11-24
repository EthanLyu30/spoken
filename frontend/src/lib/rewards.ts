import { useEffect } from "react";
import { create } from "zustand";
import { request } from "./api";
import { getAuthGeneration, subscribeAuthGeneration } from "./authToken";

export type RewardItem = "pip-scarf" | "cafe-chime" | "cafe-rain";
export const rewardsPath = "/api/practice-rewards";
export const rewardDetails = {
  "pip-scarf": { name: "围巾 Pip", description: "用作个人中心的头像。" },
  "cafe-chime": { name: "咖啡馆门铃", description: "复习或结束场景对话时，响起两声轻铃。" },
  "cafe-rain": { name: "雨天咖啡馆", description: "咖啡馆预习换成落雨的街景。" },
} satisfies Record<RewardItem, { name: string; description: string }>;

interface EquipmentState {
  generation: number;
  ready: boolean;
  items: RewardItem[];
}

const equipment = create<EquipmentState>(() => ({ generation: getAuthGeneration(), ready: false, items: [] }));
let read: AbortController | undefined;
subscribeAuthGeneration(() => {
  read?.abort();
  read = undefined;
  equipment.setState({ generation: getAuthGeneration(), ready: false, items: [] });
});

export function updateEquipment(items: RewardItem[], generation: number) {
  if (generation !== getAuthGeneration()) return;
  read?.abort();
  read = undefined;
  equipment.setState({ generation, ready: true, items });
}

async function loadEquipment(generation: number) {
  if (read || equipment.getState().ready || generation !== getAuthGeneration()) return;
  const controller = new AbortController();
  read = controller;
  try {
    const items = await request<RewardItem[]>(`${rewardsPath}/equipment`, { signal: controller.signal });
    if (!controller.signal.aborted && Array.isArray(items)) updateEquipment(items, generation);
  } catch {
    // The default appearance remains available when preferences cannot load.
  } finally {
    if (read === controller) read = undefined;
  }
}

export function useRewardEquipped(item: RewardItem, enabled = true): boolean {
  const generation = equipment(s => s.generation);
  const equipped = equipment(s => s.items.includes(item));
  useEffect(() => { if (enabled) void loadEquipment(generation); }, [enabled, generation]);
  return enabled && equipped;
}

/** Two soft bell notes, started only during an explicit user interaction. */
export async function playCafeChime(): Promise<boolean> {
  const AudioEngine = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioEngine) return false;
  let context: AudioContext | undefined;
  try {
    context = new AudioEngine();
    await context.resume();
    const initial = context.currentTime + .018;
    for (const [index, frequency] of [659.25, 880].entries()) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      const start = initial + index * .13;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(.001, start);
      volume.gain.exponentialRampToValueAtTime(.16 / (index + 1), start + .013);
      volume.gain.exponentialRampToValueAtTime(.001, start + .44);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + .45);
      if (index === 1) oscillator.addEventListener("ended", () => { void context?.close().catch(() => undefined); }, { once: true });
    }
    return true;
  } catch {
    await context?.close().catch(() => undefined);
    return false;
  }
}
