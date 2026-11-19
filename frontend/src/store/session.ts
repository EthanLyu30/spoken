import { create } from "zustand";
import type { ChatMessage, Correction, CustomScene } from "../lib/api";

/**
 * Holds the most recent practice session so the report page can analyse it.
 * Kept in memory (cleared on refresh) — persistence arrives with the DB milestone.
 */
interface SessionState {
  scenarioId: string | null;
  practiceId: string | null;
  messages: ChatMessage[];
  markedCorrections: Correction[];
  custom: CustomScene | null;
  setSession: (scenarioId: string, messages: ChatMessage[], practiceId: string, markedCorrections?: Correction[], custom?: CustomScene | null) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  scenarioId: null,
  practiceId: null,
  messages: [],
  markedCorrections: [],
  custom: null,
  setSession: (scenarioId, messages, practiceId, markedCorrections = [], custom = null) => set({ scenarioId, messages, practiceId, markedCorrections, custom }),
  clear: () => set({ scenarioId: null, practiceId: null, messages: [], markedCorrections: [], custom: null }),
}));
