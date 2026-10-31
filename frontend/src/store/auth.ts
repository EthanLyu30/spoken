import { create } from "zustand";
import {
  getMe, loginUser, registerUser, updateProfile as updateProfileApi,
  type AuthUser, ApiError,
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
let operation = 0;
let refreshRevision = 0;
function resetOwner() {
  invalidateProgress();
  useWords.getState().reset();
  useSession.getState().clear();
}
// Optional display metadata is resolved from the canonical credential, never
// hydrated independently from a shared persisted user snapshot.
export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  generation: getAuthGeneration(),
  resolving: !!getToken(),
  resolutionError: false,
  login: async (email, password) => {
    const revision = ++operation;
    const generation = getAuthGeneration();
    const { token, user } = await loginUser(email, password);
    if (revision !== operation || generation !== getAuthGeneration()) return;
    setToken(token);
    set({ user, resolving: false, resolutionError: false });
    void useWords.getState().refresh();
  },
  register: async (email, password) => {
    const revision = ++operation;
    const generation = getAuthGeneration();
    const { token, user } = await registerUser(email, password);
    if (revision !== operation || generation !== getAuthGeneration()) return;
    setToken(token);
    set({ user, resolving: false, resolutionError: false });
    void useWords.getState().refresh();
  },
  logout: () => {
    operation++;
    clearToken();
    set({ user: null, resolving: false, resolutionError: false });
    resetOwner();
    void useWords.getState().refresh();
  },
  refresh: async () => {
    if (!getToken()) {
      if (get().user) { set({ user: null }); resetOwner(); }
      set({ resolving: false, resolutionError: false });
      return;
    }
    const generation = getAuthGeneration();
    const revision = ++refreshRevision;
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
      set({ user, resolving: false, resolutionError: false });
    } catch (error) {
      if (generation !== getAuthGeneration() || revision !== refreshRevision) return;
      if (error instanceof ApiError && error.status === 401) {
        get().logout();
      } else {
        set({ resolving: false, resolutionError: !get().user });
      }
    } finally {
      clearTimeout(timer);
    }
  },
  updateProfile: async (patch) => {
    const generation = getAuthGeneration();
    const user = await updateProfileApi(patch);
    if (generation === getAuthGeneration()) set({ user });
  },
}));

subscribeAuthGeneration(() => {
  operation++;
  refreshRevision++;
  resetOwner();
  useAuth.setState({ user: null, generation: getAuthGeneration(), resolving: !!getToken(), resolutionError: false });
});
