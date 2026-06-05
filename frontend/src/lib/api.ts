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

export interface SessionSummary {
  id: number;
  scenario_id: string;
  overall: number;
  created_at: string;
}

export interface SessionDetail extends SessionSummary {
  summary: string;
  tip: string;
  scores: SkillScore[];
  messages: ChatMessage[];
}

export interface SaveSessionPayload {
  scenario_id: string;
  messages: ChatMessage[];
  overall: number;
  summary: string;
  tip: string;
  scores: SkillScore[];
}

/** Persist a finished session (transcript + feedback) for history/trends. */
export function postSession(
  payload: SaveSessionPayload,
  signal?: AbortSignal,
): Promise<SessionDetail> {
  return request<SessionDetail>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

/** Recent sessions, newest first. */
export function getSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  return request<SessionSummary[]>("/api/sessions", { signal });
}

export function getSession(id: number, signal?: AbortSignal): Promise<SessionDetail> {
  return request<SessionDetail>(`/api/sessions/${id}`, { signal });
}

/**
 * Fetch MP3 audio for a line of Pip's speech as an object URL.
 * The caller is responsible for revoking the URL when done.
 */
export async function fetchTtsUrl(
  text: string,
  scenarioId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, scenario_id: scenarioId }),
    signal,
  });
  if (!res.ok) throw new Error(`tts failed: ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/** Transcribe 16 kHz mono PCM via the backend (iFlytek ASR). */
export async function postAsr(pcm: ArrayBuffer, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/asr`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: pcm,
    signal,
  });
  if (!res.ok) throw new Error(`asr failed: ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text;
}
