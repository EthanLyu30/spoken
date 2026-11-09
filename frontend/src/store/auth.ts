import { create } from "zustand";
import {
  getMe, loginUser, registerUser, updateProfile as updateProfileApi,
  beginOwnerTransition, endOwnerTransition, flushPendingWrites, type AuthUser, ApiError,
} from "../lib/api";
import { clearToken, setToken, getToken, getAuthGeneration, subscribeAuthGeneration } from "../lib/authToken";
import { useWords } from "./words";
import { useSession } from "./session";
import { invalidateProgress } from "../lib/progressCache";

interface AuthState {
  user: AuthUser | null;
  generation: number;
  resolving: boolean;
  resolutionError: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  updateProfile: (patch: { display_name?: string; avatar_url?: string }) => Promise<void>;
}
const USER_KEY = "spoken-user";

/** JWT `sub` is a cache key, never an authorization decision. */
function tokenSubject(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part + "=".repeat((4 - part.length % 4) % 4)));
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
function readCachedUser(token: string | null): AuthUser | null {
  const subject = tokenSubject(token);
  if (!subject) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_KEY) ?? "null") as
      | { subject?: string; user?: AuthUser }
      | null;
    if (parsed?.subject === subject && typeof parsed.user?.id === "number") return parsed.user;
  } catch {
    /* fall through to the minimal account identity */
  }
  const id = Number(subject);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  // Decode only the stable subject for owner-scoped reads. Display metadata is
  // refreshed from the server; the bearer token remains the authorization.
  return { id, email: "", display_name: "", avatar_url: "", created_at: "" };
}
function writeCachedUser(token: string | null, user: AuthUser | null): void {
  try {
    const subject = tokenSubject(token);
    if (!subject || !user) localStorage.removeItem(USER_KEY);
    else localStorage.setItem(USER_KEY, JSON.stringify({ subject, user }));
  } catch {
    /* UI-only cache; the token remains authoritative. */
  }
}
let operation = 0;
let refreshRevision = 0;
function resetOwner() {
  invalidateProgress();
  useWords.getState().reset();
  useSession.getState().clear();
}
// A UI-only snapshot is keyed by the bearer token's subject. Display metadata
// is still refreshed from `/auth/me`; every data request remains token-scoped.
const initialToken = getToken();
export const useAuth = create<AuthState>((set, get) => ({
  // The snapshot only avoids a blank account area on reload. Backend calls keep
  // using the bearer token, and a 401 still clears it below.
  user: readCachedUser(initialToken),
  generation: getAuthGeneration(),
  resolving: false,
  resolutionError: false,
  login: async (email, password) => {
    const revision = ++operation;
    const generation = getAuthGeneration();
    const { token, user } = await loginUser(email, password);
    if (revision !== operation || generation !== getAuthGeneration()) return;
    setToken(token);
    writeCachedUser(token, user);
    set({ user, resolving: false, resolutionError: false });
    void useWords.getState().refresh();
  },
  register: async (email, password) => {
    const revision = ++operation;
    const generation = getAuthGeneration();
    // Stop owner writes that start after this point (summary save, another tab)
    // from using the old guest identity; they wait for the token decision.
    beginOwnerTransition();
    try {
      // A just-finished practice/word write must land while this browser is still
      // the guest owner, otherwise the server claim can move it to the account
      // and the late response would be orphaned under the old client id.
      // A failed write aborts registration: never switch account while a
      // completed practice is unsaved.
      await flushPendingWrites();
      if (revision !== operation || generation !== getAuthGeneration()) return;
      const { token, user } = await registerUser(email, password);
      if (revision !== operation || generation !== getAuthGeneration()) return;
      setToken(token);
      writeCachedUser(token, user);
      set({ user, resolving: false, resolutionError: false });
      void useWords.getState().refresh();
    } finally {
      endOwnerTransition();
    }
  },
  logout: () => {
    operation++;
    clearToken();
    writeCachedUser(null, null);
    set({ user: null, resolving: false, resolutionError: false });
    resetOwner();
    void useWords.getState().refresh();
  },
  refresh: async () => {
    const token = getToken();
    if (!token) {
      if (get().user) { set({ user: null }); resetOwner(); }
      writeCachedUser(null, null);
      set({ resolving: false, resolutionError: false });
      return;
    }
    const generation = getAuthGeneration();
    const revision = ++refreshRevision;
    // A cached snapshot is UI-only. Validate it in the background so the page
    // can paint immediately; only a missing snapshot needs a visible spinner.
    if (!get().user) set({ resolving: true, resolutionError: false });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const user = await Promise.race([
        getMe(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Account resolution timed out"));
          }, 12_000);
        }),
      ]);
      if (generation !== getAuthGeneration() || revision !== refreshRevision) return;
      writeCachedUser(token, user);
      set({ user, resolving: false, resolutionError: false });
    } catch (error) {
      if (generation !== getAuthGeneration() || revision !== refreshRevision) return;
      if (error instanceof ApiError && error.status === 401) {
        get().logout();
      } else {
        // Keep a cached account usable during a transient outage; the token is
        // retained and the next refresh can recover it.
        set({ resolving: false, resolutionError: !get().user });
      }
    } finally {
      clearTimeout(timer);
    }
  },
  updateProfile: async (patch) => {
    const generation = getAuthGeneration();
    const user = await updateProfileApi(patch);
    if (generation === getAuthGeneration()) {
      writeCachedUser(getToken(), user);
      set({ user });
    }
  },
}));

subscribeAuthGeneration(() => {
  operation++;
  refreshRevision++;
  resetOwner();
  const token = getToken();
  const cached = readCachedUser(token);
  useAuth.setState({
    user: cached,
    generation: getAuthGeneration(),
    resolving: !!token && !cached,
    resolutionError: false,
  });
});
