import { create } from "zustand";
import { type ChatMessage } from "../lib/api";

/**
 * Holds the most recent practice session so the report page can analyse it.
 * Kept in memory (cleared on refresh) — persistence arrives with the DB milestone.
 */
interface SessionState {
  scenarioId: string | null;
  practiceId: string | null;
  messages: ChatMessage[];
  setSession: (scenarioId: string, messages: ChatMessage[], practiceId: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  scenarioId: null,
  practiceId: null,
  messages: [],
  setSession: (scenarioId, messages, practiceId) => set({ scenarioId, messages, practiceId }),
  clear: () => set({ scenarioId: null, practiceId: null, messages: [] }),
}));
