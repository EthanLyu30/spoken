import { getToken } from "./authToken";
import { withTimeout } from "./requestTimeout";

export interface AdminFilters {
  hours: number; source: "server" | "browser"; operation: string; model: string; release: string; outcome: string;
}
type Percentiles = { p50: number | null; p95: number | null; p99: number | null };
export interface AdminOverview {
  source: "server" | "browser"; count: number; success_rate: number | null;
  errors: number; timeouts: number; cancelled: number;
  latency: Percentiles; ttft: Percentiles; ttft_known?: number; input_tokens: number | null; output_tokens: number | null; usage_known: number;
  operations: string[]; facets?: { operations: string[]; models: string[]; releases: string[] };
  trend: { time: string; operation: string; count: number; p95: number | null }[];
  collection: { active: boolean; retention_days: number; max_records: number; source_budget?: number; at_capacity?: boolean; oldest_at: string | null; dropped_since_restart: number; write_errors_since_restart: number };
}
export interface AdminTrace {
  interaction_id?: string | null; related?: AdminTrace[];
  trace_id: string; started_at: string; operation: string; source: string; outcome: string;
  duration_ms: number; http_status: number | null; ttft_ms: number | null; model: string | null;
  error_type?: string | null; error_cause_type?: string | null;
  input_tokens: number | null; output_tokens: number | null; release: string;
  spans?: { id: string; parent_id: string | null; name: string; offset_ms: number; duration_ms: number;
    outcome: string; attributes: Record<string, string | number | boolean> }[];
}
export class AdminApiError extends Error {
  constructor(public status: number) { super(`运行数据加载失败（${status}）`); }
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const response = await fetch(`${BASE}/api/admin${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store",
    signal: withTimeout(signal, 15_000),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.json() as Promise<T>;
}
export function query(filters: AdminFilters): URLSearchParams {
  const params = new URLSearchParams({ hours: String(filters.hours), source: filters.source });
  for (const key of ["operation", "model", "release", "outcome"] as const) if (filters[key]) params.set(key, filters[key]);
  return params;
}
export const getAdminOverview = (filters: AdminFilters, signal?: AbortSignal) => read<AdminOverview>(`/overview?${query(filters)}`, signal);
export const getAdminTraces = (filters: AdminFilters, offset: number, slow: boolean, signal?: AbortSignal) => {
  const params = query(filters); params.set("offset", String(offset)); params.set("slow_first", String(slow));
  return read<{ items: AdminTrace[]; total: number }>(`/traces?${params}`, signal);
};
export const getAdminTrace = (id: string, signal?: AbortSignal) => read<AdminTrace>(`/traces/${encodeURIComponent(id)}`, signal);
