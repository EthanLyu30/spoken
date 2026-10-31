import { TOKEN_KEY, getToken, reconcileAuthToken, subscribeAuthGeneration, invalidateGuestIdentity } from "./authToken";
import { CLIENT_ID_KEY, getClientId, subscribeClientId } from "./clientId";
import { useAuth } from "../store/auth";

let cleanup: (() => void) | undefined;
/** Install before React mounts so no owner-sensitive view uses an unresolved identity. */
export function initializeAuthSync(): () => void {
  if (cleanup) return cleanup;
  let channel: BroadcastChannel | undefined;
  let reconciling = false;
  let guestChanged = false;
  const unsubscribeGuest = subscribeClientId(() => {
    if (reconciling) guestChanged = true;
    else invalidateGuestIdentity();
  });
  const reconcile = () => {
    // Observe both durable values as one transition. A simultaneous token and
    // device change (storage.clear) must not invalidate the same identity twice.
    reconciling = true;
    getClientId();
    const changed = reconcileAuthToken();
    reconciling = false;
    if (!changed && guestChanged) invalidateGuestIdentity();
    guestChanged = false;
    if (changed) void useAuth.getState().refresh();
    return changed;
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== TOKEN_KEY && event.key !== CLIENT_ID_KEY) return;
    // A sessionStorage event is not an account notification. Access may itself
    // throw in restricted contexts, in which case RAM state remains authoritative.
    try { if (event.storageArea && event.storageArea !== localStorage) return; }
    catch { return; }
    reconcile();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", reconcile);
  try {
    channel = new BroadcastChannel("spoken-auth");
    channel.onmessage = (event) => {
      if (event.data?.type === "identity-changed") reconcile();
    };
  } catch { /* storage events are sufficient when BC is unavailable */ }
  const unsubscribe = subscribeAuthGeneration((external) => {
    if (!external) {
      try { channel?.postMessage({ type: "identity-changed" }); } catch { /* optional */ }
    }
  });
  cleanup = () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("focus", reconcile);
    unsubscribe();
    unsubscribeGuest();
    try { channel?.close(); } catch { /* optional */ }
    cleanup = undefined;
  };
  const changed = reconcile();
  if (!changed && getToken() && !useAuth.getState().user) void useAuth.getState().refresh();
  return cleanup;
}
export function cleanupAuthSync(): void { cleanup?.(); }
