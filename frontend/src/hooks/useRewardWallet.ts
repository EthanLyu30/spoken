import { useEffect } from "react";
import { create } from "zustand";
import { ApiError, request } from "../lib/api";
import { getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { rewardsPath, updateEquipment, type RewardItem } from "../lib/rewards";

export interface ShopItem { id: RewardItem; price: number; owned: boolean }
export interface RewardAchievement { id: "seven-days" | "five-scenes"; count: number; target: number; earned: boolean }
export type WeeklyGoal = "practice-days" | "review-expressions";
export interface WeeklyRewards {
  starts_on: string;
  ends_on: string;
  goals: { id: WeeklyGoal; count: number; target: number; coins: number; claimed: boolean }[];
}
export interface RewardWallet {
  date: string; coins: number; streak: number; checked_in: boolean;
  goal_count: number; goal_target: number; goal_claimed: boolean;
  checkin_coins: number; goal_coins: number; wallpaper_price: number; wallpaper_unlocked: boolean;
  items: ShopItem[]; equipment: RewardItem[]; achievements: RewardAchievement[]; weekly?: WeeklyRewards;
}
interface WalletState {
  generation: number; wallet: RewardWallet | null; pending: boolean; error: string; notice: string;
}

const emptyWallet = (): WalletState => ({ generation: getAuthGeneration(), wallet: null, pending: false, error: "", notice: "" });
const useWalletState = create<WalletState>(emptyWallet);
let reading: AbortController | undefined;
let writing: AbortController | undefined;

subscribeAuthGeneration(() => {
  reading?.abort();
  writing?.abort();
  reading = writing = undefined;
  useWalletState.setState(emptyWallet());
});

function storeWallet(wallet: RewardWallet, generation: number) {
  useWalletState.setState({ wallet, error: "" });
  updateEquipment(wallet.equipment ?? [], generation);
}

async function refreshWallet() {
  if (reading || writing) return;
  const generation = getAuthGeneration();
  const controller = new AbortController();
  reading = controller;
  try {
    const wallet = await request<RewardWallet>(rewardsPath, { signal: controller.signal });
    if (!controller.signal.aborted && generation === getAuthGeneration()) storeWallet(wallet, generation);
  } catch {
    if (!controller.signal.aborted && generation === getAuthGeneration()) useWalletState.setState({ error: "暂时无法读取金币和奖励。" });
  } finally {
    if (reading === controller) reading = undefined;
  }
}

// A claim may finish after navigation from Home to the shop. Both views use the
// same server balance and pending write; changing owner retires both requests.
async function changeWallet(endpoint: string, init: RequestInit, notice: string, generation: number) {
  if (generation !== getAuthGeneration() || writing || !useWalletState.getState().wallet) return;
  reading?.abort();
  reading = undefined;
  const controller = new AbortController();
  writing = controller;
  const current = () => !controller.signal.aborted && generation === getAuthGeneration();
  useWalletState.setState({ pending: true, error: "", notice: "" });
  try {
    const wallet = await request<RewardWallet>(rewardsPath + endpoint, { ...init, signal: controller.signal });
    if (current()) {
      storeWallet(wallet, generation);
      useWalletState.setState({ notice });
    }
  } catch (failure) {
    if (!current()) return;
    if (failure instanceof ApiError && failure.status === 409) {
      try {
        const wallet = await request<RewardWallet>(rewardsPath, { signal: controller.signal });
        if (current()) storeWallet(wallet, generation);
      } catch { /* Keep the last balance and allow a retry. */ }
    }
    if (current()) useWalletState.setState({ error: failure instanceof ApiError && failure.status === 409 ? failure.message : "这次操作未确认，请重试。" });
  } finally {
    if (writing === controller) writing = undefined;
    if (current()) useWalletState.setState({ pending: false });
  }
}

export function useRewardWallet(practiceCount?: number) {
  const state = useWalletState();
  useEffect(() => {
    useWalletState.setState({ notice: "" });
    void refreshWallet();
    window.addEventListener("focus", refreshWallet);
    return () => window.removeEventListener("focus", refreshWallet);
  }, [state.generation, practiceCount]);
  return {
    ...state,
    refresh: refreshWallet,
    change: (endpoint: string, init: RequestInit, message: string) => changeWallet(endpoint, init, message, state.generation),
  };
}
