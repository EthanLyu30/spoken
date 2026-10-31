/** Canonical current-page credentials. Only explicit reconciliation reads storage. */
export const TOKEN_KEY = "spoken-token";
let initialized = false;
let currentToken: string | null = null;
let memoryOverride = false;
let generation = 0;
type Listener = (external: boolean) => void;
const listeners = new Set<Listener>();

export function getToken(): string | null {
  if (!initialized) {
    initialized = true;
    try { currentToken = localStorage.getItem(TOKEN_KEY); } catch { /* RAM guest */ }
  }
  return currentToken;
}
export function getAuthGeneration(): number { getToken(); return generation; }
/** Retain workflow identity across awaits, including transport fallback chains. */
export function assertAuthGeneration(expected: number, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (expected !== getAuthGeneration()) throw new DOMException("Identity changed", "AbortError");
}
export function subscribeAuthGeneration(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Device identity changes matter only while using the guest credential. */
export function invalidateGuestIdentity(): void {
  if (getToken()) return;
  generation++;
  for (const listener of listeners) listener(true);
}
function adopt(token: string | null, external: boolean): boolean {
  if (token === getToken()) return false;
  generation++;
  currentToken = token;
  for (const listener of listeners) listener(external);
  return true;
}
export function reconcileAuthToken(): boolean {
  if (memoryOverride) return false;
  try { return adopt(localStorage.getItem(TOKEN_KEY), true); }
  catch { return false; }
}
export function setToken(token: string): void {
  getToken();
  try {
    localStorage.setItem(TOKEN_KEY, token);
    memoryOverride = false;
  } catch {
    memoryOverride = true;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* RAM override wins */ }
  }
  adopt(token, false);
}
export function clearToken(): void {
  getToken();
  try { localStorage.removeItem(TOKEN_KEY); memoryOverride = false; }
  catch { memoryOverride = true; }
  adopt(null, false);
}
