/**
 * The account JWT, kept in localStorage and read by the API client on every
 * request. Stored separately from the auth store (which holds the user object)
 * so `api.ts` can attach the token without importing the store — avoiding a
 * cycle (auth store -> api -> auth store).
 */
const KEY = "spoken-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore (private mode / storage disabled) */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
