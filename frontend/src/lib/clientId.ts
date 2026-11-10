/**
 * Per-device identity (no login). A stable random id is stored in localStorage
 * and sent as the X-Client-Id header so each browser sees only its own word bag,
 * history and stats. Clearing site data or using another browser starts fresh.
 */
export const CLIENT_ID_KEY = "spoken-client-id";
const KEY = CLIENT_ID_KEY;
const GUEST_HISTORY_PREFIX = "spoken-guest-history:";
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

function validGuestId(id: string | undefined): id is string {
  return !!id && id.length <= 64 && id.toLowerCase() !== "anon" && !id.toLowerCase().startsWith("u:");
}

export function getClientId(): string {
  const previous = currentId;
  try {
    const id = localStorage.getItem(KEY)?.trim();
    if (validGuestId(id)) {
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

/** A claimed guest id must not be reused after logout. */
export function rotateClientId(): string {
  try {
    const previous = localStorage.getItem(KEY)?.trim();
    if (validGuestId(previous)) localStorage.setItem(GUEST_HISTORY_PREFIX + previous, String(Date.now()));
  } catch { /* the current guest can still rotate when storage is unavailable */ }
  currentId = newId();
  memoryOnly = false;
  try { localStorage.setItem(KEY, currentId); } catch { memoryOnly = true; }
  for (const listener of listeners) listener();
  return currentId;
}

/** IDs stay on this browser and are used only for explicitly requested guest reads. */
export function browserGuestHistoryIds(): string[] {
  const active = getClientId();
  const previous: { id: string; at: number }[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(GUEST_HISTORY_PREFIX)) continue;
      const id = key.slice(GUEST_HISTORY_PREFIX.length);
      if (id !== active && validGuestId(id)) previous.push({ id, at: Number(localStorage.getItem(key)) || 0 });
    }
  } catch { /* the active guest remains accessible */ }
  return [active, ...previous.sort((a, b) => b.at - a.at).map(({ id }) => id)];
}
