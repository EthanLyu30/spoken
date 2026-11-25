import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getAuthGeneration, getToken, tokenCacheIdentity } from "../lib/authToken";
import { getClientId } from "../lib/clientId";
import { resilientStorage } from "../lib/resilientStorage";
import { deleteWord, getWords, patchWord, patchWordTopic, patchWordTopicGroup, postWord, rateWordRetest, reviewWord, type ReviewChoice, type Word, type WordCreate, type WordRetestRound } from "../lib/api";
let tempSeq = -1;
let ownerGeneration = 0;
let revision = 0;
let refreshRevision = 0;
let topicWrites: Promise<unknown> = Promise.resolve();
interface CollectionIntent {
  desired: boolean;
  row: Word;
  payload: WordCreate;
  running: boolean;
  request?: Promise<Word | undefined>;
}
const collections = new Map<string, CollectionIntent>();
const mutations = new Map<string, {
  revision: number;
  pending: number;
}>();
const queues = new Map<number, Promise<unknown>>();
const mastery = new Map<number, {
  row: Word;
  revision: number;
  confirmed: boolean;
  pending: number;
}>();
type WordIdentity = Pick<Word, "id" | "created_at" | "text">;
type ReviewIntent = WordIdentity & {
  remembered: ReviewChoice;
  key: string;
  order: number;
};
type ReviewScope = { owner: string; generation: number; auth: number };
type ReviewReceipt = { intent: ReviewIntent; scope: ReviewScope };
const recentReviewReceiptLimit = 256;

function sameWord(left: WordIdentity, right?: WordIdentity): boolean {
  return !!right && left.id === right.id && left.created_at === right.created_at && left.text === right.text;
}
function reviewOwner(): string | null {
  const token = getToken();
  if (!token) return `guest:${getClientId()}`;
  const claims = tokenCacheIdentity(token);
  // Include account version so a reused numeric user id cannot load an old queue.
  return claims ? `account:${claims.subject}:${claims.version}` : null;
}
function reviewScope(): ReviewScope | null {
  const owner = reviewOwner();
  return owner ? { owner, generation: ownerGeneration, auth: getAuthGeneration() } : null;
}
function scopeIsCurrent(scope: ReviewScope): boolean {
  const owner = reviewOwner();
  return scope.owner === owner && scope.generation === ownerGeneration && scope.auth === getAuthGeneration();
}
function assertReviewScope(scope: ReviewScope) {
  if (!scopeIsCurrent(scope)) throw new DOMException("Owner changed", "AbortError");
}
const reviewStoragePrefix = (owner: string) => `spoken-word-rating:${encodeURIComponent(owner)}:`;
const reviewStorageKey = (owner: string, key: string) => reviewStoragePrefix(owner) + encodeURIComponent(key);
const knownReviewStorageKeys = new Set<string>();
function readReviewIntents(owner: string): ReviewIntent[] {
  const prefix = reviewStoragePrefix(owner);
  const keys = new Set([...knownReviewStorageKeys].filter(key => key.startsWith(prefix)));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.add(key);
    }
  } catch { /* Keep the current page functional when durable storage is unavailable. */ }
  const intents: ReviewIntent[] = [];
  for (const key of keys) {
    try {
      const raw = resilientStorage.getItem(key);
      if (!raw) { knownReviewStorageKeys.delete(key); continue; }
      const item = JSON.parse(raw) as Partial<ReviewIntent> | null;
      if (item && typeof item.id === "number" && Number.isSafeInteger(item.id) && item.id > 0 &&
          typeof item.created_at === "string" && typeof item.text === "string" &&
          typeof item.key === "string" && reviewStorageKey(owner, item.key) === key &&
          typeof item.order === "number" && Number.isFinite(item.order) &&
          (typeof item.remembered === "boolean" || item.remembered === "uncertain")) {
        knownReviewStorageKeys.add(key);
        intents.push(item as ReviewIntent);
      }
    } catch { /* A malformed entry must not block another pending rating. */ }
  }
  return intents.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}
function writeReviewIntent(owner: string, intent: ReviewIntent) {
  // Acknowledging an older receipt must not overwrite a new choice another
  // tab just selected. Store and remove each immutable intent separately.
  const key = reviewStorageKey(owner, intent.key);
  knownReviewStorageKeys.add(key);
  resilientStorage.setItem(key, JSON.stringify(intent));
}
function removeReviewIntents(owner: string, remove: (intent: ReviewIntent) => boolean) {
  const matches = readReviewIntents(owner).filter(remove);
  for (const intent of matches) {
    const key = reviewStorageKey(owner, intent.key);
    resilientStorage.removeItem(key);
    knownReviewStorageKeys.delete(key);
  }
  return matches.length > 0;
}
function wordChanged() {
  return Object.assign(new Error("这条收藏已更新，请返回列表重新打开。"), { code: "word_changed" });
}
export function isWordReviewStale(error: unknown): boolean {
  return !!error && typeof error === "object" && (
    ("code" in error && error.code === "word_changed") || ("status" in error && error.status === 404));
}
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
function enqueueTopic<T>(generation: number, action: () => Promise<T>): Promise<T> {
  const operation = topicWrites.catch(() => undefined).then(() => {
    if (generation !== ownerGeneration) throw new DOMException("Owner changed", "AbortError");
    return action();
  });
  topicWrites = operation;
  return operation;
}
interface WordsState {
  words: Word[];
  confirmedReviewReceipts: ReadonlyMap<string, ReviewReceipt>;
  fetchedOnce: boolean;
  refreshing: boolean;
  error: boolean;
  ensureLoaded: () => void;
  refresh: (signal?: AbortSignal) => Promise<void>;
  collect: (payload: WordCreate) => Promise<Word | undefined> | undefined;
  remove: (id: number) => void;
  toggleMaster: (id: number) => void;
  review: (word: Word, remembered: ReviewChoice, intentId: string) => Promise<void>;
  rateRetest: (word: Word, roundId: string, position: number, choice: ReviewChoice) => Promise<WordRetestRound>;
  setTopic: (id: number, topic: string | null) => Promise<void>;
  editTopic: (source: string, target: string | null) => Promise<number>;
  reset: () => void;
}
export const useWords = create<WordsState>()(persist((set, get) => {
  const replace = (text: string, row?: Word) => set(s => ({
    words: row
      ? [row, ...s.words.filter(w => w.text !== text && w.id !== row.id)]
      : s.words.filter(w => w.text !== text)
  }));
  const liveWord = (word: WordIdentity) => get().words.find(candidate => sameWord(word, candidate));
  function enqueueReview<T>(target: WordIdentity, scope: ReviewScope, action: () => Promise<T>): Promise<T> {
    mutation(target.text, 1);
    return enqueue(target.id, scope.generation, async () => {
      assertReviewScope(scope);
      return action();
    }).finally(() => {
      if (scope.generation === ownerGeneration) mutation(target.text, -1);
    });
  }
  async function settleReviewIntents(intents: ReviewIntent[], scope: ReviewScope, requireCachedWord: boolean) {
    for (const intent of intents) {
      assertReviewScope(scope);
      if (requireCachedWord && !liveWord(intent)) throw wordChanged();
      const { id, key, remembered, created_at } = intent;
      // Another tab may already have acknowledged the same durable receipt.
      if (!readReviewIntents(scope.owner).some(item => item.key === key)) continue;
      // Confirm the older receipt before issuing the next decision. A failed
      // attempt leaves every unsent decision on disk with its original key.
      let row: Word;
      try {
        row = await reviewWord(id, remembered, undefined, key, created_at);
        assertReviewScope(scope);
        if (!sameWord(intent, row)) throw wordChanged();
      } catch (error) {
        if (scopeIsCurrent(scope) && isWordReviewStale(error))
          removeReviewIntents(scope.owner, item => sameWord(intent, item));
        throw error;
      }
      // Another tab may have already advanced the schedule. Confirm the exact
      // receipt, but don't replace the cache from an out-of-date response.
      const acknowledgedHere = removeReviewIntents(scope.owner, item => item.key === key);
      set(s => {
        const confirmedReviewReceipts = new Map(s.confirmedReviewReceipts).set(key, { intent, scope });
        if (confirmedReviewReceipts.size > recentReviewReceiptLimit) {
          const oldest = confirmedReviewReceipts.keys().next().value;
          if (oldest !== undefined) confirmedReviewReceipts.delete(oldest);
        }
        return { confirmedReviewReceipts, ...(acknowledgedHere ? { words: s.words.map(word => sameWord(intent, word) ? {
          ...word, box: row.box, due_at: row.due_at, last_reviewed: row.last_reviewed, familiarity: row.familiarity,
        } : word) } : {}) };
      });
    }
  }
  function replayReviews(target: WordIdentity, scope: ReviewScope, until?: string): Promise<void> {
    const intents = readReviewIntents(scope.owner).filter(item => sameWord(target, item));
    const end = until ? intents.findIndex(item => item.key === until) + 1 : intents.length;
    if (!end) return Promise.resolve();
    return enqueueReview(target, scope, () => settleReviewIntents(intents.slice(0, end), scope, true));
  }
  function resumeReviews() {
    const scope = reviewScope();
    if (!scope) return;
    const rows = new Map<number, ReviewIntent>();
    for (const item of readReviewIntents(scope.owner))
      if (liveWord(item)) rows.set(item.id, item);
    for (const row of rows.values()) void replayReviews(row, scope).catch(() => undefined);
  }
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
          const scope = reviewScope();
          await enqueue(intent.row.id, generation, () => deleteWord(intent.row.id));
          if (generation !== ownerGeneration)
            return;
          if (scope && scopeIsCurrent(scope)) removeReviewIntents(scope.owner, item => sameWord(intent.row, item));
          if (sameWord(intent.row, mastery.get(intent.row.id)?.row)) mastery.delete(intent.row.id);
          intent.row = { ...intent.row, id: tempSeq-- };
          if (intent.desired)
            replace(text, intent.row);
        }
        else
          break;
      }
      if (generation === ownerGeneration && intent.desired && intent.row.id > 0)
        return intent.row;
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
    words: [], confirmedReviewReceipts: new Map(), fetchedOnce: false, refreshing: false, error: false,
    ensureLoaded: () => {
      if (!get().fetchedOnce && !get().refreshing)
        void get().refresh();
      else if (!get().refreshing) resumeReviews();
    },
    refresh: async (signal) => {
      const scope = reviewScope(), generation = ownerGeneration, started = revision, request = ++refreshRevision;
      set({ refreshing: true, error: false });
      try {
        const rows = await getWords(signal);
        if ((scope && !scopeIsCurrent(scope)) || generation !== ownerGeneration || request !== refreshRevision)
          return;
        set(s => {
          const protectedTexts = new Set([...mutations].filter(([, m]) => m.pending > 0 || m.revision > started).map(([text]) => text));
          const local = s.words.filter(w => protectedTexts.has(w.text));
          const protectedIds = new Set(local.map(w => w.id));
          const words = [...local, ...rows.filter(w => !protectedTexts.has(w.text) && !protectedIds.has(w.id))];
          // An authoritative row can replace an old SQLite id. Retire only
          // missing incarnations, never pending receipts for the live row.
          if (scope) removeReviewIntents(scope.owner, item =>
            !protectedTexts.has(item.text) && !words.some(word => sameWord(item, word)));
          for (const [id, status] of mastery) {
            if (!status.pending && !protectedTexts.has(status.row.text)) mastery.delete(id);
          }
          return { words, fetchedOnce: true, refreshing: false };
        });
        if (scope && scopeIsCurrent(scope)) resumeReviews();
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
        return existing.request;
      }
      const row: Word = { id: tempSeq--, text, meaning: payload.meaning ?? "", example: payload.example ?? "", scenario_id: payload.scenario_id ?? "",
        source: payload.source, topic: payload.topic, kind: payload.kind ?? "word", mastered: false, created_at: new Date().toISOString() };
      const intent: CollectionIntent = { desired: true, row, payload, running: false };
      collections.set(text, intent);
      replace(text, row);
      return intent.request = syncCollection(text, intent, ownerGeneration);
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
      const { text, meaning, example, kind, scenario_id, source, topic } = row;
      const intent: CollectionIntent = { desired: false, row, payload: { text, meaning, example, kind, scenario_id, source, topic }, running: false };
      collections.set(row.text, intent);
      intent.request = syncCollection(row.text, intent, ownerGeneration);
    },
    toggleMaster: id => {
      const generation = ownerGeneration, target = get().words.find(w => w.id === id);
      if (!target || id < 0)
        return;
      const previous = mastery.get(id);
      const status = previous && sameWord(target, previous.row) ? previous : { row: target, revision: 0, confirmed: target.mastered, pending: 0 };
      mastery.set(id, status);
      status.pending++;
      const current = ++status.revision, mastered = !target.mastered;
      mutation(target.text, 1);
      set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered } : w) }));
      void enqueue(id, generation, () => {
        if (!sameWord(target, get().words.find(w => w.id === id))) throw new DOMException("Word changed", "AbortError");
        return patchWord(id, mastered);
      }).then(row => {
        if (generation !== ownerGeneration || mastery.get(id) !== status || !sameWord(target, get().words.find(w => w.id === id)))
          return;
        status.confirmed = row.mastered;
        if (current === status.revision)
          set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered: row.mastered } : w) }));
      }).catch(() => {
        if (generation === ownerGeneration && mastery.get(id) === status && current === status.revision && sameWord(target, get().words.find(w => w.id === id)))
          set(s => ({ words: s.words.map(w => w.id === id ? { ...w, mastered: status.confirmed } : w) }));
      }).finally(() => {
        if (generation === ownerGeneration) {
          mutation(target.text, -1);
          status.pending--;
          // Idle writes no longer own a rollback baseline. The next toggle
          // starts from whichever row the user can currently see.
          if (!status.pending && mastery.get(id) === status) mastery.delete(id);
        }
      });
    },
    setTopic: async (id, topic) => {
      const target = get().words.find(w => w.id === id);
      if (!target || id < 0) throw new Error("请先保存表达。");
      const generation = ownerGeneration;
      mutation(target.text, 1);
      try {
        await enqueueTopic(generation, async () => {
          if (!sameWord(target, get().words.find(w => w.id === id))) throw new DOMException("Word changed", "AbortError");
          const row = await patchWordTopic(id, topic);
          if (generation === ownerGeneration) set(s => ({ words: s.words.map(w => sameWord(target, w) ? { ...w, topic: row.topic } : w) }));
        });
      } finally {
        if (generation === ownerGeneration) mutation(target.text, -1);
      }
    },
    editTopic: (source, target) => {
      const generation = ownerGeneration;
      return enqueueTopic(generation, async () => {
        const updated = await patchWordTopicGroup(source, target);
        if (generation !== ownerGeneration) throw new DOMException("Owner changed", "AbortError");
        const changed = new Map(updated.map(word => [word.id, word]));
        for (const word of updated) mutation(word.text, 0);
        set(s => ({ words: s.words.map(word => {
          const row = changed.get(word.id);
          return row && sameWord(word, row) ? { ...word, topic: row.topic } : word;
        }) }));
        if (!updated.length) await get().refresh();
        return updated.length;
      });
    },
    review: async (word, remembered, intentId) => {
      if (word.id < 0)
        throw new Error("请等待单词保存后再复习。");
      const scope = reviewScope();
      if (!scope) throw new Error("账号还未确认，请刷新后重试。");
      if (!liveWord(word)) throw wordChanged();
      const confirmed = get().confirmedReviewReceipts.get(intentId);
      const intents = readReviewIntents(scope.owner);
      const existing = intents.find(item => item.key === intentId);
      const acknowledged = confirmed && scopeIsCurrent(confirmed.scope) ? confirmed.intent : undefined;
      const prior = existing ?? acknowledged;
      if (prior && (!sameWord(word, prior) || prior.remembered !== remembered))
        throw new Error("这次保存的熟悉度和先前选择不同。");
      if (acknowledged) return;
      if (!existing) {
        const { id, created_at, text } = word;
        const order = Math.max(Date.now(), (intents.at(-1)?.order ?? 0) + 1);
        writeReviewIntent(scope.owner, { id, created_at, text, remembered, key: intentId, order });
      }
      await replayReviews(word, scope, intentId);
    },
    rateRetest: async (word, roundId, position, choice) => {
      const scope = reviewScope();
      if (!scope) throw new Error("账号还未确认，请刷新后重试。");
      const earlier = readReviewIntents(scope.owner).filter(intent => sameWord(word, intent));
      return enqueueReview(word, scope, async () => {
        try {
          // The retest can contain server-added rows that aren't cached yet.
          await settleReviewIntents(earlier, scope, false);
        } catch (error) {
          assertReviewScope(scope);
          // Let the retest endpoint handle a deleted/changed incarnation. A
          // transient receipt failure must instead leave this retest retryable.
          if (!isWordReviewStale(error)) throw Object.assign(new Error("上一次复习还未确认保存。"), { cause: error });
        }
        assertReviewScope(scope);
        return rateWordRetest(roundId, position, choice);
      });
    },
    reset: () => {
      ownerGeneration++;
      refreshRevision++;
      collections.clear();
      mutations.clear();
      queues.clear();
      topicWrites = Promise.resolve();
      mastery.clear();
      set({ words: [], confirmedReviewReceipts: new Map(), fetchedOnce: false, refreshing: false, error: false });
    },
  };
}, { name: "spoken-words", skipHydration: true, storage: createJSONStorage(() => resilientStorage), partialize: s => ({ words: s.words.filter(w => w.id > 0) }) }));
