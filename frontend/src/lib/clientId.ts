/**
 * Per-device identity (no login). A stable random id is stored in localStorage
 * and sent as the X-Client-Id header so each browser sees only its own word bag,
 * history and stats. Clearing site data or using another browser starts fresh.
 */
export const CLIENT_ID_KEY = "spoken-client-id";
const KEY = CLIENT_ID_KEY;
let currentId: string | null = null;
let memoryOnly = false;
const listeners = new Set<() => void>();
/** Observed durable guest changes invalidate old work before a request is sent. */
export function subscribeClientId(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const newId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function getClientId(): string {
  const previous = currentId;
  try {
    const id = localStorage.getItem(KEY)?.trim();
    if (id && id.length <= 64 && id.toLowerCase() !== "anon" && !id.toLowerCase().startsWith("u:")) {
      memoryOnly = false;
      return currentId = id;
    }
    if (!memoryOnly) currentId = newId();
    currentId ??= newId();
    memoryOnly = true;
    localStorage.setItem(KEY, currentId);
    memoryOnly = false;
    return currentId;
  } catch {
    // Storage restrictions must not merge unrelated people into one owner.
    memoryOnly = true;
    return currentId ??= newId();
  } finally {
    if (previous !== null && currentId !== previous) {
      for (const listener of listeners) listener();
    }
  }
}
