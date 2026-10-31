import { getClientId } from './clientId';
import { getToken } from './authToken';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/** Dedicated visit signal; timing samples remain content- and identity-free. */
export async function recordSiteVisit(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const id = getClientId();
    const token = getToken();
    if (id === 'anon' && !token) return;
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 8_000);
    await fetch(`${BASE}/api/telemetry/visit`, {
      method: 'POST', keepalive: true, signal: controller.signal,
      headers: { 'X-Client-Id': id, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch { /* An optional visit signal must not interrupt navigation or audio. */ }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
