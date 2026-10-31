/**
 * The account JWT, kept in localStorage and read by the API client on every
 * request. Stored separately from the auth store (which holds the user object)
 * so `api.ts` can attach the token without importing the store — avoiding a
 * cycle (auth store -> api -> auth store).
 */
const KEY = "spoken-token";
let currentToken: string | null = null;
let memoryOverride = false;

export function getToken(): string | null {
  if (memoryOverride) return currentToken;
  try {
    return currentToken = localStorage.getItem(KEY);
  } catch {
    return currentToken;
  }
}

export function setToken(token: string): void {
  currentToken = token;
  try {
    localStorage.setItem(KEY, token);
    memoryOverride = false;
  } catch {
    memoryOverride = true;
    // If writes hit quota but removal still works, do not retain the previous
    // account token for a later page load. This page uses the new RAM session.
    try { localStorage.removeItem(KEY); } catch { /* current-page override wins */ }
  }
}

export function clearToken(): void {
  currentToken = null;
  try {
    localStorage.removeItem(KEY);
    memoryOverride = false;
  } catch {
    // A readable stale token must not resurrect after a failed removal.
    memoryOverride = true;
  }
}
