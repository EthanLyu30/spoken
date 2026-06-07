import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getMe, loginUser, registerUser, type AuthUser } from "../lib/api";
import { clearToken, setToken } from "../lib/authToken";
import { useWords } from "./words";

/**
 * Account session. The JWT lives in localStorage (see authToken.ts) so the API
 * client can read it directly; this store keeps the reactive `user` for the UI.
 *
 * The word bag is cached per owner, so any auth change resets it and refetches
 * under the new identity (account on login, device on logout).
 */
interface AuthState {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Validate the persisted token against the server; clears it if stale. */
  refresh: () => Promise<void>;
}

function swapOwner() {
  const words = useWords.getState();
  words.reset();
  void words.refresh();
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,

      login: async (email, password) => {
        const { token, user } = await loginUser(email, password);
        setToken(token);
        set({ user });
        swapOwner();
      },

      register: async (email, password) => {
        const { token, user } = await registerUser(email, password);
        setToken(token);
        set({ user });
        swapOwner();
      },

      logout: () => {
        clearToken();
        set({ user: null });
        swapOwner();
      },

      refresh: async () => {
        try {
          set({ user: await getMe() });
        } catch {
          clearToken();
          set({ user: null });
        }
      },
    }),
    {
      name: "spoken-auth",
      partialize: (s) => ({ user: s.user }),
    },
  ),
);
