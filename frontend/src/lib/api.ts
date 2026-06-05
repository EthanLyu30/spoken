/**
 * Backend API client.
 *
 * In dev, requests to `/api/*` are proxied to the FastAPI server by Vite
 * (see vite.config.ts). In other environments, set VITE_API_BASE_URL.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export interface HealthResponse {
  status: string;
  app: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** Liveness check used to surface backend connectivity in the UI. */
export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
}
