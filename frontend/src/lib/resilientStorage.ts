import type { StateStorage } from "zustand/middleware";

// Persisted display/preferences are optional caches. Storage restrictions must
// not make an otherwise successful login, logout or preference change throw.
const memory = new Map<string, string | null>();
const overrides = new Set<string>();
export const resilientStorage: StateStorage = {
  getItem(key) {
    if (overrides.has(key)) return memory.get(key) ?? null;
    try {
      const value = localStorage.getItem(key);
      memory.set(key, value);
      return value;
    } catch { return memory.get(key) ?? null; }
  },
  setItem(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(key,value); overrides.delete(key); }
    catch { overrides.add(key); }
  },
  removeItem(key) {
    memory.set(key,null);
    try { localStorage.removeItem(key); overrides.delete(key); }
    catch { overrides.add(key); }
  },
};
