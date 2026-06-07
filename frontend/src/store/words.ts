import { create } from "zustand";
import { persist } from "zustand/middleware";
import { deleteWord, getWords, patchWord, postWord, reviewWord, type Word } from "../lib/api";

/**
 * Single source of truth for the word bag, cached in localStorage so pages open
 * instantly (the list shows from cache while a background refresh revalidates).
 *
 * Every mutation is *optimistic*: the UI updates immediately and the network
 * call runs in the background, rolling back on failure. With one writer per
 * device this keeps the bag feeling instant even when the backend round-trip is
 * slow (free-tier host + remote Postgres). Negative ids mark not-yet-saved
 * entries; they are never persisted and are reconciled when the POST resolves.
 */
let tempSeq = -1;

interface CollectPayload {
  text: string;
  meaning?: string;
  example?: string;
  scenario_id?: string;
  kind?: string;
}

interface WordsState {
  words: Word[];
  fetchedOnce: boolean; // not persisted — revalidate once per session
  refreshing: boolean; // not persisted
  error: boolean; // not persisted
  /** Fetch from the server once per session (no-op if already loaded/loading). */
  ensureLoaded: () => void;
  /** Force a fresh fetch, merging in any in-flight optimistic entries. */
  refresh: (signal?: AbortSignal) => Promise<void>;
  /** Optimistically save a word/phrase; ignored if its text is already present. */
  collect: (payload: CollectPayload) => void;
  /** Remove by id (optimistic; rolls back on failure). */
  remove: (id: number) => void;
  /** Toggle the mastered flag (optimistic). */
  toggleMaster: (id: number) => void;
  /** Record an SRS review result; the card is assumed already advanced in the UI. */
  review: (id: number, remembered: boolean) => void;
  /** Drop the cache so the next load refetches (used on login/logout). */
  reset: () => void;
}

export const useWords = create<WordsState>()(
  persist(
    (set, get) => ({
      words: [],
      fetchedOnce: false,
      refreshing: false,
      error: false,

      ensureLoaded: () => {
        if (get().fetchedOnce || get().refreshing) return;
        void get().refresh();
      },

      refresh: async (signal) => {
        set({ refreshing: true, error: false });
        try {
          const ws = await getWords(signal);
          set((s) => {
            // Preserve optimistic entries the server hasn't seen yet.
            const temps = s.words.filter((w) => w.id < 0 && !ws.some((x) => x.text === w.text));
            return { words: [...temps, ...ws], fetchedOnce: true, refreshing: false };
          });
        } catch {
          if (signal?.aborted) {
            set({ refreshing: false });
            return;
          }
          set({ refreshing: false, error: true });
        }
      },

      collect: (payload) => {
        const text = payload.text.trim();
        if (!text || get().words.some((w) => w.text === text)) return;
        const id = tempSeq--;
        const temp: Word = {
          id,
          text,
          meaning: payload.meaning ?? "",
          example: payload.example ?? "",
          scenario_id: payload.scenario_id ?? "",
          kind: payload.kind ?? "word",
          mastered: false,
          created_at: new Date().toISOString(),
        };
        set((s) => ({ words: [temp, ...s.words] }));
        postWord({
          text,
          meaning: payload.meaning,
          example: payload.example,
          scenario_id: payload.scenario_id,
          kind: payload.kind,
        })
          .then((real) => {
            if (get().words.some((w) => w.id === id)) {
              set((s) => ({ words: s.words.map((w) => (w.id === id ? real : w)) }));
            } else {
              // Un-collected before the save landed — drop the orphaned server row.
              deleteWord(real.id).catch(() => undefined);
            }
          })
          .catch(() => set((s) => ({ words: s.words.filter((w) => w.id !== id) })));
      },

      remove: (id) => {
        const target = get().words.find((w) => w.id === id);
        if (!target) return;
        set((s) => ({ words: s.words.filter((w) => w.id !== id) }));
        if (id < 0) return; // not yet saved server-side
        deleteWord(id).catch(() => set((s) => ({ words: [target, ...s.words] })));
      },

      toggleMaster: (id) => {
        const target = get().words.find((w) => w.id === id);
        if (!target || id < 0) return;
        const mastered = !target.mastered;
        set((s) => ({ words: s.words.map((w) => (w.id === id ? { ...w, mastered } : w)) }));
        patchWord(id, mastered)
          .then((u) => set((s) => ({ words: s.words.map((w) => (w.id === id ? u : w)) })))
          .catch(() => set((s) => ({ words: s.words.map((w) => (w.id === id ? target : w)) })));
      },

      review: (id, remembered) => {
        if (id < 0) return;
        reviewWord(id, remembered)
          .then((u) => set((s) => ({ words: s.words.map((w) => (w.id === id ? u : w)) })))
          .catch(() => undefined);
      },

      reset: () => set({ words: [], fetchedOnce: false, refreshing: false, error: false }),
    }),
    {
      name: "spoken-words",
      // Only persist saved rows; in-flight temps (negative ids) never hit storage.
      partialize: (s) => ({ words: s.words.filter((w) => w.id > 0) }),
    },
  ),
);
