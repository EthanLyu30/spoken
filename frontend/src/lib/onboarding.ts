/** First-run onboarding flag (kept out of the component file so Vite Fast
 * Refresh works — a component file should only export components). */
export const ONBOARDING_KEY = "spoken-onboarded";

export function hasOnboarded(): boolean {
  try {
    return !!localStorage.getItem(ONBOARDING_KEY);
  } catch {
    return true; // storage unavailable -> don't nag
  }
}

export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Re-open the onboarding from settings. */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(ONBOARDING_KEY);
  } catch {
    /* ignore */
  }
}
