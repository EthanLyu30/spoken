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

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResponse {
  scenario_id: string;
  reply: string;
  opening: boolean;
}

/**
 * One role-play turn. Pass the conversation so far; an empty list asks the
 * backend for the scripted scene opener (no model call).
 */
export function postChat(
  scenarioId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId, messages }),
    signal,
  });
}

export interface SkillScore {
  key: string;
  label_en: string;
  label_zh: string;
  score: number;
}

export interface Correction {
  original: string;
  suggestion: string;
  note: string;
}

export interface Phrase {
  text: string;
  note: string;
}

export interface FeedbackResponse {
  scenario_id: string;
  overall: number;
  summary: string;
  scores: SkillScore[];
  corrections: Correction[];
  phrases: Phrase[];
  tip: string;
}

/** Post-session feedback on a text conversation (scores, corrections, tips). */
export function postFeedback(
  scenarioId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<FeedbackResponse> {
  return request<FeedbackResponse>("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId, messages }),
    signal,
  });
}
