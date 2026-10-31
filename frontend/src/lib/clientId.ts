/**
 * Per-device identity (no login). A stable random id is stored in localStorage
 * and sent as the X-Client-Id header so each browser sees only its own word bag,
 * history and stats. Clearing site data or using another browser starts fresh.
 */
const KEY = "spoken-client-id";
let currentId: string | null = null;
const newId = () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function getClientId(): string {
  try {
    const id = localStorage.getItem(KEY)?.trim();
    if (id && id.length <= 64 && id.toLowerCase() !== "anon" && !id.toLowerCase().startsWith("u:"))
      return currentId = id;
    currentId ??= newId();
    localStorage.setItem(KEY, currentId);
    return currentId;
  } catch {
    // Storage restrictions must not merge unrelated people into one owner.
    return currentId ??= newId();
  }
}
