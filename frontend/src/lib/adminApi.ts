import { getToken } from "./authToken";
import { withTimeout } from "./requestTimeout";

export type AdminTraffic = "unmarked" | "test" | "all";
export type AdminDelivery = "all" | "replay";
export interface AdminFilters {
  hours: number; source: "server" | "browser"; operation: string; model: string; release: string; outcome: string;
  traffic: AdminTraffic; testRunId: string; delivery: AdminDelivery;
}
type Percentiles = { p50: number | null; p95: number | null; p99: number | null };
export interface AdminPricing {
  configured_model: string; official_version: string; checked_at: string; source_url: string;
  currency: string; per_tokens: number; rates: { input_hit: number[]; input_miss: number[]; output: number[] };
  model_records: number; priced_records: number; unknown_usage_records: number; unpriced_records: number;
  min_cny: number | null; max_cny: number | null;
}
export interface AdminVisitors {
  guest_uv: number | null; registered_active: number | null; enabled: boolean;
  started_at: string | null; hours: number; max_records: number; at_capacity: boolean;
}
export interface AdminGuestActivity {
  hours: number; active_browsers: number; sessions: number; pronunciation: number;
  interviews: number; word_collections: number; word_reviews: number;
}
export interface AdminGuestRequests {
  first_sample_at: string | null;
  at_capacity: boolean;
  windows: {
    hours: number; active_browsers: number; requests: number; failed: number; cancelled: number;
    by_kind: Record<"dialogue" | "asr" | "pronunciation" | "interview" | "feedback", number>;
  }[];
}
export interface AdminExperience {
  stages: (Percentiles & { operation: string; samples: number })[];
  playback: {
    completed: number; failed: number; cancelled: number; classified: number; never_started: number;
    recovered: number; recovery_failed: number; recovery_cancelled: number;
  };
}
export interface AdminAsrReplays {
  count: number;
  failed_count: number;
  unclassified_count: number;
  delay_samples: number;
  median_delay_ms: number | null;
}
export interface AdminSampleCoverage {
  oldest_at: string | null;
  newest_at: string | null;
}
export interface AdminOverview {
  coverage?: AdminSampleCoverage;
  asr_replays?: AdminAsrReplays;
  visitors?: AdminVisitors;
  experience?: AdminExperience;
  pricing?: AdminPricing;
  source: "server" | "browser"; server_release?: string; traffic_filter?: boolean; delivery_filter?: boolean;
  count: number; success_rate: number | null;
  errors: number; timeouts: number; cancelled: number;
  latency: Percentiles; ttft: Percentiles; ttft_known?: number; input_tokens: number | null; output_tokens: number | null; usage_known: number;
  operations: string[]; facets?: { operations: string[]; models: string[]; releases: string[] };
  trend: { time: string; operation: string; count: number; p95: number | null }[];
  collection: { active: boolean; retention_days: number; max_records: number; source_budget?: number; at_capacity?: boolean; oldest_at: string | null; dropped_since_restart: number; write_errors_since_restart: number;
    sources?: Partial<Record<"server" | "browser", { source_budget: number; at_capacity: boolean; retained?: number; oldest_at?: string | null; test_budget?: number; test_retained?: number }>>;
    cleanup?: { active: boolean; interval_seconds: number; last_success_at: string | null; failures_since_restart: number } };
}
export interface AdminUser {
  id: number; email: string; display_name: string; created_at: string; last_active: string | null;
  sessions: number; words: number; practice: number;
}
export interface AdminUsersPage {
  items: AdminUser[]; registered: number; total: number; limit: number; new_7d: number;
  activation_24h: { eligible: number; completed: number };
  visitors: AdminVisitors;
  guest_activity?: AdminGuestActivity;
  guest_requests?: AdminGuestRequests;
}
export type AdminUserSort = "activity" | "registered";
export interface AdminTrace {
  interaction_id?: string | null; related?: AdminTrace[];
  trace_id: string; started_at: string; operation: string; source: string; outcome: string;
  occurred_at?: string | null; received_at?: string | null; is_replay?: boolean | null;
  audience?: "guest";
  duration_ms: number; http_status: number | null; ttft_ms: number | null; model: string | null;
  error_type?: string | null; error_cause_type?: string | null; test_run_id?: string | null;
  cost_min_cny?: number | null; cost_max_cny?: number | null;
  input_tokens: number | null; output_tokens: number | null; release: string;
  spans?: { id: string; parent_id: string | null; name: string; offset_ms: number; duration_ms: number;
    outcome: string; attributes: Record<string, string | number | boolean> }[];
}
export interface AdminTracePage {
  items: AdminTrace[];
  total: number;
  coverage?: AdminSampleCoverage;
}
export class AdminApiError extends Error {
  constructor(public status: number) { super(`运行数据加载失败（${status}）`); }
}

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
export async function getDeployedBrowserRelease(signal: AbortSignal): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}index.html`, {
    cache: "no-store", signal: withTimeout(signal, 2_000),
  });
  if (!response.ok) return "unknown";
  const html = new DOMParser().parseFromString(await response.text(), "text/html");
  const release = html.querySelector<HTMLMetaElement>('meta[name="spoken-release"]')?.content;
  return release && /^[a-f0-9]{40}$/i.test(release) ? release : "unknown";
}
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
  if (filters.traffic !== "all") params.set("traffic", filters.traffic);
  if (filters.testRunId) params.set("test_run_id", filters.testRunId);
  if (filters.source === "browser" && filters.delivery === "replay") params.set("delivery", filters.delivery);
  return params;
}
export function getAdminOverview(filters: AdminFilters, signal?: AbortSignal, includeExperience = false,
  experienceServerRelease?: string, experienceBrowserRelease?: string) {
  const params = query(filters);
  if (includeExperience) params.set("include_experience", "true");
  if (experienceServerRelease) params.set("experience_server_release", experienceServerRelease);
  if (experienceBrowserRelease) params.set("experience_browser_release", experienceBrowserRelease);
  return read<AdminOverview>(`/overview?${params}`, signal);
}
export const getAdminTraces = (filters: AdminFilters, offset: number, slow: boolean, signal?: AbortSignal) => {
  const params = query(filters); params.set("offset", String(offset)); params.set("slow_first", String(slow));
  return read<AdminTracePage>(`/traces?${params}`, signal);
};
export const getAdminTrace = (id: string, signal?: AbortSignal) => read<AdminTrace>(`/traces/${encodeURIComponent(id)}`, signal);
export function getAdminUsers(options: { offset: number; search: string; sort: AdminUserSort }, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: "20", offset: String(options.offset), sort: options.sort });
  if (options.search) params.set("search", options.search);
  return read<AdminUsersPage>(`/users?${params}`, signal);
}
