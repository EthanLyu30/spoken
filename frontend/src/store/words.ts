import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resilientStorage } from "../lib/resilientStorage";
import { createPracticeId } from "../lib/sessionSave";
import { deleteWord, getWords, patchWord, postWord, reviewWord, type Word } from "../lib/api";
let tempSeq = -1;
let ownerGeneration = 0;
let revision = 0;
let refreshRevision = 0;
interface CollectPayload {
  text: string;
  meaning?: string;
  example?: string;
  scenario_id?: string;
  kind?: string;
}
interface CollectionIntent {
  desired: boolean;
  row: Word;
  payload: CollectPayload;
  running: boolean;
}
const collections = new Map<string, CollectionIntent>();
const mutations = new Map<string, {
  revision: number;
  pending: number;
}>();
const queues = new Map<number, Promise<unknown>>();
const mastery = new Map<number, {
  revision: number;
  confirmed: boolean;
}>();
const reviews = new Map<number, {
  remembered: boolean;
  key: string;
  pending?: Promise<void>;
}>();
function mutation(text: string, delta: number) {
  const previous = mutations.get(text);
  mutations.set(text, { revision: ++revision, pending: (previous?.pending ?? 0) + delta });
}
/** Serialize writes before dispatch, so the server also observes the last intent. */
function enqueue<T>(id: number, generation: number, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(id);
  const run = async () => {
    if (generation !== ownerGeneration)
      throw new DOMException("Owner changed", "AbortError");
    return action();
  };
  const next = previous ? previous.catch(() => undefined).then(run) : run();
  queues.set(id, next);
  void next.finally(() => {
    if (queues.get(id) === next)
      queues.delete(id);
  }).catch(() => undefined);
  return next;
}
interface WordsState {
  words: Word[];
  fetchedOnce: boolean;
  refreshing: boolean;
  error: boolean;
  ensureLoaded: () => void;
  refresh: (signal?: AbortSignal) => Promise<void>;
  collect: (payload: CollectPayload) => void;
  remove: (id: number) => void;
  toggleMaster: (id: number) => void;
  review: (id: number, remembered: boolean) => Promise<void>;
  reset: () => void;
}
export const useWords = create<WordsState>()(persist((set, get) => {
  const replace = (text: string, row?: Word) => set(s => ({
    words: row
      ? [row, ...s.words.filter(w => w.text !== text && w.id !== row.id)]
      : s.words.filter(w => w.text !== text)
  }));
  async function syncCollection(text: string, intent: CollectionIntent, generation: number) {
    if (intent.running)
      return;
    intent.running = true;
    mutation(text, 1);
    try {
      while (generation === ownerGeneration) {
        if (intent.desired && intent.row.id < 0) {
          const real = await postWord({ ...intent.payload, text });
          if (generation !== ownerGeneration)
            return;
          intent.row = real;
          if (intent.desired)
            replace(text, real);
        }
        else if (!intent.desired && intent.row.id > 0) {
          await enqueue(intent.row.id, generation, () => deleteWord(intent.row.id));
          if (generation !== ownerGeneration)
            return;
          intent.row = { ...intent.row, id: tempSeq-- };
          if (intent.desired)
            replace(text, intent.row);
        }
        else
          break;
      }
    }
    catch {
      if (generation !== ownerGeneration)
        return;
      // Roll back only the failed operation's still-current intent.
      if (intent.row.id < 0 && intent.desired)
        replace(text);
      else if (intent.row.id > 0 && !intent.desired)
        replace(text, intent.row);
      set({ error: true });
    }
    finally {
      if (generation === ownerGeneration) {
        intent.running = false;
        collections.delete(text);
        mutation(text, -1);
      }
    }
  }
  return {
    words: [], fetchedOnce: false, refreshing: false, error: false,
    ensureLoaded: () => {
      if (!get().fetchedOnce && !get().refreshing)
        void get().refresh();
    },
    refresh: async (signal) => {
      const generation = ownerGeneration, started = revision, request = ++refreshRevision;
      set({ refreshing: true, error: false });
      try {
        const rows = await getWords(signal);
        if (generation !== ownerGeneration || request !== refreshRevision)
          return;
        set(s => {
          const protectedTexts = new Set([...mutations].filter(([, m]) => m.pending > 0 || m.revision > started).map(([text]) => text));
          return { words: [...s.words.filter(w => protectedTexts.has(w.text)), ...rows.filter(w => !protectedTexts.has(w.text))], fetchedOnce: true, refreshing: false };
        });
      }
      catch {
        if (generation === ownerGeneration && request === refreshRevision)
          set({ refreshing: false, ...(!signal?.aborted ? { error: true } : {}) });
      }
    },
    collect: payload => {
      const text = payload.text.trim();
      if (!text || get().words.some(w => w.text === text))
        return;
      const existing = collections.get(text);
      if (existing) {
        existing.desired = true;
        mutation(text, 0);
        replace(text, existing.row);
        return;
      }
      const row: Word = { id: tempSeq--, text, meaning: payload.meaning ?? "", example: payload.example ?? "", scenario_id: payload.scenario_id ?? "", kind: payload.kind ?? "word", mastered: false, created_at: new Date().toISOString() };
      const intent = { desired: true, row, payload, running: false };
      collections.set(text, intent);
      replace(text, row);
      void syncCollection(text, intent, ownerGeneration);
    },
    remove: id => {
      const row = get().words.find(w => w.id === id);
      if (!row)
        return;
      replace(row.text);
      const existing = collections.get(row.text);
      if (existing) {
        existing.desired = false;
        mutation(row.text, 0);
        return;
      }
      const intent = { desired: false, row, payload: { text: row.text, meaning: row.meaning, example: row.example, kind: row.kind, scenario_id: row.scenario_id }, running: false };
      collections.set(row.text, intent);
      void syncCollection(row.text, intent, ownerGeneration);
    },
    toggleMaster: id => {
      const generation = ownerGeneration, target = get().words.find(w => w.id === id);
      if (!target || id < 0)
        return;
      const status = mastery.get(id) ?? { revision: 0, confirmed: target.mastered };
      mastery.set(id, status);
      const current = ++status.revision, mastered = !target.mastered;
      mutation(target.text, 1);
      set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered } : w) }));
      void enqueue(id, generation, () => patchWord(id, mastered)).then(row => {
        if (generation !== ownerGeneration)
          return;
        status.confirmed = row.mastered;
        if (current === status.revision)
          set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered: row.mastered } : w) }));
      }).catch(() => {
        if (generation === ownerGeneration && current === status.revision)
          set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered: status.confirmed } : w) }));
      }).finally(() => {
        if (generation === ownerGeneration)
          mutation(target.text, -1);
      });
    },
    review: async (id, remembered) => {
      if (id < 0)
        throw new Error("请等待单词保存后再复习。");
      const target = get().words.find(w => w.id === id), generation = ownerGeneration;
      if (!target)
        throw new Error("单词已移除。");
      let operation = reviews.get(id);
      if (operation && operation.remembered !== remembered)
        throw Object.assign(new Error("请先重试上次复习保存。"), { remembered: operation.remembered });
      if (operation?.pending)
        return operation.pending;
      operation ??= { remembered, key: createPracticeId() };
      reviews.set(id, operation);
      const attempt = operation;
      mutation(target.text, 1);
      attempt.pending = enqueue(id, generation, () => reviewWord(id, remembered, undefined, attempt.key)).then(row => {
        if (generation !== ownerGeneration)
          throw new DOMException("Owner changed", "AbortError");
        // A later optimistic mastery choice still owns that field.
        const desired = get().words.find(w => w.id === id)?.mastered;
        set(s => ({ words: s.words.map(w => w.id === id ? { ...row, mastered: desired ?? row.mastered } : w) }));
        reviews.delete(id);
      }).finally(() => {
        if (generation === ownerGeneration) {
          attempt.pending = undefined;
          mutation(target.text, -1);
        }
      });
      return attempt.pending;
    },
    reset: () => {
      ownerGeneration++;
      refreshRevision++;
      collections.clear();
      mutations.clear();
      queues.clear();
      mastery.clear();
      reviews.clear();
      set({ words: [], fetchedOnce: false, refreshing: false, error: false });
    },
  };
}, { name: "spoken-words", skipHydration: true, storage: createJSONStorage(() => resilientStorage), partialize: s => ({ words: s.words.filter(w => w.id > 0) }) }));
