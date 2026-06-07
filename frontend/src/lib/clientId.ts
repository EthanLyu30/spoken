/**
 * Per-device identity (no login). A stable random id is stored in localStorage
 * and sent as the X-Client-Id header so each browser sees only its own word bag,
 * history and stats. Clearing site data or using another browser starts fresh.
 */
const KEY = "spoken-client-id";

export function getClientId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}
