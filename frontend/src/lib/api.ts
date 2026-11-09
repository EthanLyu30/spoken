/**
 * Backend API client.
 *
 * In dev, requests to `/api/*` are proxied to the FastAPI server by Vite
 * (see vite.config.ts). In other environments, set VITE_API_BASE_URL.
 */
import { getToken, getAuthGeneration, assertAuthGeneration, subscribeAuthGeneration } from "./authToken";
import { deviceTimezone, learningDay } from "./learningDay";
import { getClientId } from "./clientId";
import { readChatStream } from "./chatStream";
import { transcribeDirect } from "./directAsr";
import { withTimeout } from "./requestTimeout";
import { invalidateProgress, progressGeneration, subscribeProgress } from "./progressCache";
import { ReadResource } from "./readResource";
import { traceHeaders, getInteraction, reportTiming } from "./telemetry";
import { assertAudioWithinLimit } from "./audioLimits";
import { AsrQuotaError, asrProviderError, isAsrQuotaCooling, isAsrQuotaError } from "./asrQuota";
export { withTimeout } from "./requestTimeout";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const DEFAULT_TIMEOUT = 60_000; // generous: DeepSeek replies can be slow
const metadata = new ReadResource();
subscribeAuthGeneration(() => metadata.clear());
subscribeProgress(() => metadata.clear());

async function readMetadata<T>(path: string, signal?: AbortSignal, force = false): Promise<T> {
  const auth = getAuthGeneration();
  const device = getClientId();
  // getClientId may itself reconcile a changed guest identity.
  assertAuthGeneration(auth, signal);
  const progress = progressGeneration();
  const day = learningDay();
  const valid = () => auth === getAuthGeneration() && progress === progressGeneration()
    && day === learningDay() && device === getClientId() && auth === getAuthGeneration();
  const key = JSON.stringify([auth, device, progress, day, BASE_URL, path]);
  return metadata.read(key, sharedSignal => request<T>(path, { signal: sharedSignal }), valid, signal, force);
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Bearer header when logged in; empty when browsing anonymously. */
function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const pendingWrites = new Map<Promise<void>, { error: unknown | null }>();
const OWNER_TRANSITION_KEY = "spoken-owner-transition";
const OWNER_OUTCOME_KEY = "spoken-owner-transition-outcome";
const OWNER_QUEUE_KEY = "spoken-owner-pending-writes";
let localTransition: OwnerTransition | null = null;
const externalTransitions = new Map<string, Promise<OwnerTransitionOutcome>>();
const queuedWrites = new Map<string, StoredOwnerWrite>();
const inflightWrites = new Map<string, Promise<unknown>>();

type OwnerTransitionOutcome = {
  id: string;
  status: "success" | "failed" | "unknown";
  targetUserId?: number;
  error?: string;
};
type OwnerTransition = {
  id: string;
  guestId: string;
  startedAt: number;
  outcome: Promise<OwnerTransitionOutcome>;
  settle: (outcome: OwnerTransitionOutcome) => void;
};
type StoredOwnerWrite = {
  id: string;
  transitionId: string;
  guestId: string;
  path: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
  createdAt: number;
};

/** A queued save is safe on disk but its ownership is not confirmed yet. */
export class OwnerTransitionError extends Error {
  readonly code = "owner_transition_pending";
  constructor(message = "身份确认尚未完成，记录已保留，可稍后重试") {
    super(message);
    this.name = "OwnerTransitionError";
  }
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function tokenSubject(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4))) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function transitionDescriptor(): { id: string; guestId: string; startedAt: number } | null {
  try {
    const raw = localStorage.getItem(OWNER_TRANSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: unknown; guestId?: unknown; startedAt?: unknown };
    if (typeof parsed.id !== "string" || typeof parsed.guestId !== "string" || typeof parsed.startedAt !== "number") return null;
    return { id: parsed.id, guestId: parsed.guestId, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

function readTransitionOutcome(id: string): OwnerTransitionOutcome | null {
  try {
    const raw = localStorage.getItem(OWNER_OUTCOME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OwnerTransitionOutcome>;
    if (parsed.id !== id || (parsed.status !== "success" && parsed.status !== "failed" && parsed.status !== "unknown")) return null;
    return { id, status: parsed.status, targetUserId: parsed.targetUserId, error: parsed.error };
  } catch {
    return null;
  }
}

function writeTransitionOutcome(outcome: OwnerTransitionOutcome): void {
  try { localStorage.setItem(OWNER_OUTCOME_KEY, JSON.stringify(outcome)); } catch { /* RAM-only */ }
}

function clearTransitionDescriptor(): void {
  try { localStorage.removeItem(OWNER_TRANSITION_KEY); } catch { /* RAM-only transition */ }
}

function loadQueuedWrites(): void {
  try {
    const raw = localStorage.getItem(OWNER_QUEUE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Partial<StoredOwnerWrite>;
      if (typeof row.id !== "string" || typeof row.transitionId !== "string" || typeof row.guestId !== "string"
        || typeof row.path !== "string" || typeof row.method !== "string" || typeof row.createdAt !== "number") continue;
      queuedWrites.set(row.id, {
        id: row.id,
        transitionId: row.transitionId,
        guestId: row.guestId,
        path: row.path,
        method: row.method,
        body: typeof row.body === "string" ? row.body : null,
        headers: row.headers && typeof row.headers === "object" ? row.headers as Record<string, string> : {},
        createdAt: row.createdAt,
      });
    }
  } catch { /* ignore corrupt local queue */ }
}

function persistQueuedWrites(): void {
  // Merge with what other tabs/module instances already persisted.
  const merged = new Map<string, StoredOwnerWrite>();
  try {
    const raw = localStorage.getItem(OWNER_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        if (row && typeof row === "object" && typeof (row as StoredOwnerWrite).id === "string") {
          merged.set((row as StoredOwnerWrite).id, row as StoredOwnerWrite);
        }
      }
    }
  } catch { /* ignore corrupt persisted queue */ }
  for (const row of queuedWrites.values()) merged.set(row.id, row);
  try {
    localStorage.setItem(OWNER_QUEUE_KEY, JSON.stringify([...merged.values()]));
  } catch { /* the in-memory copy still protects this page */ }
}

function removeQueuedWrite(id: string): void {
  queuedWrites.delete(id);
  try {
    const raw = localStorage.getItem(OWNER_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      localStorage.setItem(OWNER_QUEUE_KEY, JSON.stringify(parsed.filter((row) =>
        !row || typeof row !== "object" || (row as StoredOwnerWrite).id !== id)));
    }
  } catch { /* in-memory deletion still applies */ }
}

loadQueuedWrites();

function waitExternalOutcome(id: string): Promise<OwnerTransitionOutcome> {
  const existing = readTransitionOutcome(id);
  if (existing) return Promise.resolve(existing);
  const cached = externalTransitions.get(id);
  if (cached) return cached;
  const promise = new Promise<OwnerTransitionOutcome>((resolve) => {
    let done = false;
    const finish = (outcome: OwnerTransitionOutcome) => {
      if (done) return;
      done = true;
      window.removeEventListener("storage", onStorage);
      clearTimeout(timer);
      resolve(outcome);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === OWNER_OUTCOME_KEY) {
        const outcome = readTransitionOutcome(id);
        if (outcome) finish(outcome);
        return;
      }
      // A removed marker without a success/failure outcome is inconclusive;
      // keep the record queued instead of sending it as the old guest.
      if (event.key === OWNER_TRANSITION_KEY && !transitionDescriptor()) {
        finish({ id, status: "unknown", error: "transition ended without an outcome" });
      }
    };
    const timer = setTimeout(() => finish({ id, status: "unknown", error: "transition outcome timed out" }), 60_000);
    window.addEventListener("storage", onStorage);
  });
  externalTransitions.set(id, promise);
  return promise;
}

function discardStaleTransition(): void {
  const descriptor = transitionDescriptor();
  if (descriptor && Date.now() - descriptor.startedAt > 60_000) clearTransitionDescriptor();
}

function currentTransition(): { id: string; guestId: string; outcome: Promise<OwnerTransitionOutcome> } | null {
  if (localTransition) return { id: localTransition.id, guestId: localTransition.guestId, outcome: localTransition.outcome };
  discardStaleTransition();
  const descriptor = transitionDescriptor();
  if (!descriptor) return null;
  const outcome = waitExternalOutcome(descriptor.id);
  return { id: descriptor.id, guestId: descriptor.guestId, outcome };
}

/** Stop new owner writes from using the old identity while registration runs. */
export function beginOwnerTransition(): { id: string; guestId: string } {
  discardStaleTransition();
  if (localTransition) {
    throw new OwnerTransitionError("已有注册正在进行，请等待当前注册完成");
  }
  if (transitionDescriptor()) {
    throw new OwnerTransitionError("另一个标签页正在注册，请等待其完成");
  }
  const id = randomId();
  const guestId = getClientId();
  let settle!: (outcome: OwnerTransitionOutcome) => void;
  const outcome = new Promise<OwnerTransitionOutcome>((resolve) => { settle = resolve; });
  localTransition = { id, guestId, startedAt: Date.now(), outcome, settle };
  try {
    localStorage.setItem(OWNER_TRANSITION_KEY, JSON.stringify({ id, guestId, startedAt: Date.now() }));
  } catch { /* the in-memory transition still protects this tab */ }
  return { id, guestId };
}

/** Record the outcome of the specific registration transaction. */
export function completeOwnerTransition(
  status: OwnerTransitionOutcome["status"],
  targetUserId?: number,
  error?: string,
): void {
  if (!localTransition) return;
  const outcome: OwnerTransitionOutcome = { id: localTransition.id, status, targetUserId, error };
  localTransition.settle(outcome);
  writeTransitionOutcome(outcome);
  clearTransitionDescriptor();
  localTransition = null;
}

/** Compatibility helper for callers that only signal failure. */
export function endOwnerTransition(): void {
  completeOwnerTransition("failed", undefined, "registration ended without a confirmed owner");
}

function headersForStored(record: StoredOwnerWrite, token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Client-Id": record.guestId,
    "X-Timezone": deviceTimezone(),
    Authorization: `Bearer ${token}`,
    ...record.headers,
  };
}

async function sendStoredWrite<T>(record: StoredOwnerWrite, token: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${record.path}`, {
    method: record.method,
    headers: headersForStored(record, token),
    body: record.body,
    signal: withTimeout(undefined, DEFAULT_TIMEOUT),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      if (data && typeof data.detail === "string") detail = data.detail;
    } catch { /* non-JSON error body */ }
    throw new ApiError(detail || `${record.method} ${record.path} failed: ${response.status}`, response.status);
  }
  const data = await response.json() as T;
  if (/^\/api\/(sessions|practice|words)(\/|$)/.test(record.path)) invalidateProgress();
  return data;
}

async function queuedWrite<T>(
  transition: { id: string; guestId: string; outcome: Promise<OwnerTransitionOutcome> },
  path: string,
  init?: RequestInit,
): Promise<T> {
  const record: StoredOwnerWrite = {
    id: randomId(),
    transitionId: transition.id,
    guestId: transition.guestId,
    path,
    method: init?.method ?? "POST",
    body: typeof init?.body === "string" ? init.body : null,
    headers: init?.headers && typeof init.headers === "object"
      ? init.headers as Record<string, string>
      : {},
    createdAt: Date.now(),
  };
  queuedWrites.set(record.id, record);
  persistQueuedWrites();
  const outcome = await transition.outcome;
  if (outcome.status !== "success" || !outcome.targetUserId) {
    throw new OwnerTransitionError(outcome.error ?? "注册未确认成功，记录已保留，可稍后重试");
  }
  const token = getToken();
  if (tokenSubject(token) !== String(outcome.targetUserId)) {
    throw new OwnerTransitionError("当前登录账号不是该注册记录的目标账号，记录已保留");
  }
  return sendOnce<T>(record, token!);
}

async function sendOnce<T>(record: StoredOwnerWrite, token: string): Promise<T> {
  const existing = inflightWrites.get(record.id) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = (async () => {
    const data = await sendStoredWrite<T>(record, token);
    removeQueuedWrite(record.id);
    return data;
  })();
  inflightWrites.set(record.id, promise);
  try {
    return await promise;
  } finally {
    inflightWrites.delete(record.id);
  }
}

/** Retry records that can be proven to belong to the currently signed-in account. */
export async function retryPendingOwnerWrites(): Promise<number> {
  const token = getToken();
  if (!token) return 0;
  const subject = tokenSubject(token);
  const outcome = (() => {
    try {
      const raw = localStorage.getItem(OWNER_OUTCOME_KEY);
      return raw ? JSON.parse(raw) as OwnerTransitionOutcome : null;
    } catch { return null; }
  })();
  let sent = 0;
  loadQueuedWrites();
  for (const record of [...queuedWrites.values()]) {
    if (inflightWrites.has(record.id)) continue;
    const targetMatches = outcome?.status === "success" && outcome.id === record.transitionId
      && String(outcome.targetUserId) === subject;
    let allowed = targetMatches;
    if (!allowed) {
      // Lost registration response: ask the server whether this guest was
      // claimed by *this* account before sending anything.
      try {
        const response = await fetch(`${BASE_URL}/api/auth/guest-claim?guest_id=${encodeURIComponent(record.guestId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const status = await response.json() as { claimed?: boolean; mine?: boolean };
          allowed = status.claimed === true && status.mine === true;
        }
      } catch { /* keep queued */ }
    }
    if (!allowed) continue;
    await sendOnce(record, token);
    sent++;
  }
  return sent;
}

function isOwnerWrite(path: string, init?: RequestInit): boolean {
  return Boolean(init?.method && init.method !== "GET" && /^\/api\/(sessions|practice|words)(\/|$)/.test(path));
}

/**
 * Wait until every owner-scoped write that started before registration has
 * reached the server and succeeded. Writes starting after the transition are
 * queued separately and are released only by a confirmed transition outcome.
 */
export async function flushPendingWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    const entries = [...pendingWrites.entries()];
    await Promise.all(entries.map(([settled]) => settled));
    const failed = entries.filter(([, result]) => result.error !== null);
    if (failed.length > 0) {
      for (const [settled] of failed) pendingWrites.delete(settled);
      throw failed[0][1].error;
    }
  }
}

export interface HealthResponse {
  status: string;
  app: string;
}

/**
 * Combine the caller's abort signal with a timeout so a hung request fails
 * cleanly (surfaced as an error the UI can show) instead of spinning forever.
 */
async function request<T>(path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT): Promise<T> {
  const ownerWrite = isOwnerWrite(path, init);
  // Only a guest write can be waiting for a guest→account transition. If a
  // token is already present (e.g. account B), keep that write under B and do
  // not adopt someone else's in-flight registration.
  const transition = ownerWrite && !getToken() ? currentTransition() : null;
  if (transition) return queuedWrite<T>(transition, path, init);
  const generation = getAuthGeneration();
  const checkGeneration = () => { if (generation !== getAuthGeneration()) throw new DOMException("Account changed", "AbortError"); };
  const requestInit: RequestInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId(),
      "X-Timezone": deviceTimezone(),
      ...authHeader(),
      ...traceHeaders(init?.signal),
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: withTimeout(init?.signal, timeoutMs),
  };
  let settlePending: ((error?: unknown) => void) | null = null;
  if (ownerWrite) {
    let resolve!: () => void;
    const settled = new Promise<void>((done) => { resolve = done; });
    const entry: { error: unknown | null } = { error: null };
    pendingWrites.set(settled, entry);
    settlePending = (error) => {
      entry.error = error ?? null;
      if (!error) pendingWrites.delete(settled);
      resolve();
    };
  }
  try {
    checkGeneration();
    const response = fetch(`${BASE_URL}${path}`, requestInit);
    const res = await response;
    checkGeneration();
    if (!res.ok) {
      // Surface the backend's message (FastAPI `detail`) when present, e.g. the
      // Chinese login/register errors; fall back to a generic status string.
      let detail = "";
      try {
        const data = await res.json();
        if (data && typeof data.detail === "string") detail = data.detail;
      } catch {
        /* non-JSON error body */
      }
      checkGeneration();
      throw new ApiError(detail || `${init?.method ?? "GET"} ${path} failed: ${res.status}`, res.status);
    }
    const data = await res.json() as T;
    checkGeneration();
    if (init?.method && init.method !== "GET" && /^\/api\/(sessions|practice|words)(\/|$)/.test(path)) invalidateProgress();
    settlePending?.();
    return data;
  } catch (error) {
    settlePending?.(error);
    throw error;
  }
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

/** A user-defined role-play scene generated by DeepSeek. */
export interface CustomScene {
  title: string;
  title_zh: string;
  partner_role: string;
  goal: string;
  persona: string;
  opening_line: string;
  /** Short Chinese theme tag (display-only), e.g. "日常生活·邻里". */
  source?: string;
}

/** Expand a learner's short description into a full role-play scene. */
export function createCustomScene(
  description: string,
  signal?: AbortSignal,
): Promise<CustomScene> {
  return request<CustomScene>("/api/custom-scenario", {
    method: "POST",
    body: JSON.stringify({ description }),
    signal,
  });
}

/** The day's featured scene (cached server-side per day); `fresh` regenerates. */
export function getScenarioSuggestion(fresh = false, signal?: AbortSignal): Promise<CustomScene> {
  return request<CustomScene>(`/api/scenario-suggestion${fresh ? "?fresh=1" : ""}`, { signal });
}

export type CorrectionIssueKind = "grammar" | "expression";

export interface TurnCorrectionIssue {
  kind: CorrectionIssueKind;
  original: string;
  replacement: string;
  note: string;
}

export interface TurnCorrectionResponse {
  original: string;
  natural: boolean;
  suggestion: string;
  issues: TurnCorrectionIssue[];
  explanation: string;
}

export interface TurnCorrectionPayload {
  scenario_id: string;
  text: string;
  previous_partner_message: string;
  custom?: CustomScene;
}

/** Analyse one learner turn without waiting for the end-of-session report. */
export function postTurnCorrection(
  payload: TurnCorrectionPayload,
  signal?: AbortSignal,
): Promise<TurnCorrectionResponse> {
  return request<TurnCorrectionResponse>("/api/turn-correction", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  }, 18_000);
}

export interface DictionaryEntry {
  query: string;
  phonetic: string;
  part_of_speech: string;
  meaning: string;
  example: string;
  example_zh: string;
}

export function postDictionaryLookup(
  query: string,
  signal?: AbortSignal,
): Promise<DictionaryEntry> {
  return request<DictionaryEntry>("/api/dictionary/lookup", {
    method: "POST",
    body: JSON.stringify({ query }),
    signal,
  }, 15_000);
}

/**
 * One role-play turn. Pass the conversation so far; an empty list asks the
 * backend for the scripted scene opener (no model call). Pass `custom` to
 * role-play a user-defined scene instead of a catalogue scenario.
 */
export function postChat(
  scenarioId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  custom?: CustomScene,
): Promise<ChatResponse> {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId, messages: messages.slice(-40), custom }),
    signal,
  });
}

/**
 * Stream one role-play turn as plain-text deltas. `onText` receives the full
 * accumulated reply each time more arrives. Resolves with the final text.
 * Throws on any failure so the caller can fall back to {@link postChat}.
 */
export async function streamChat(
  scenarioId: string,
  messages: ChatMessage[],
  onText: (full: string) => void,
  signal?: AbortSignal,
  custom?: CustomScene,
): Promise<string> {
  const requestedAt = performance.now();
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "text/event-stream", "X-Client-Id": getClientId(), ...authHeader(), ...traceHeaders(signal) },
    body: JSON.stringify({ scenario_id: scenarioId, messages: messages.slice(-40), custom }),
    signal: withTimeout(signal, 60_000),
  });
  return readChatStream(res, onText, {requestedAt, interactionId: getInteraction(signal)});
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
  custom?: CustomScene,
): Promise<FeedbackResponse> {
  return request<FeedbackResponse>("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ scenario_id: scenarioId, messages: messages.slice(-60), custom }),
    signal,
  }, 30_000);
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
  client_session_id?: string;
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
export function getSessions(signal?: AbortSignal, force = false): Promise<SessionSummary[]> {
  return readMetadata<SessionSummary[]>("/api/sessions", signal, force);
}

export function getSession(id: number, signal?: AbortSignal): Promise<SessionDetail> {
  return request<SessionDetail>(`/api/sessions/${id}`, { signal });
}

type AsrFallbackReason = "timeout" | "disconnect" | "provider_error" | "empty" | "http_error" | "unavailable" | "unknown";

function asrFallbackReason(error: unknown): AsrFallbackReason {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || /timed? ?out/i.test(message)) return "timeout";
  if (/disconnect|closed|network|fetch/i.test(message)) return "disconnect";
  if (/no transcript|empty/i.test(message)) return "empty";
  if (/unavailable|cooling down/i.test(message)) return "unavailable";
  if (/asr failed/i.test(message)) return "http_error";
  return "provider_error";
}

/** Transcribe 16 kHz mono PCM via the backend (iFlytek ASR). */
export async function postAsr(
  pcm: ArrayBuffer,
  signal?: AbortSignal,
  onTransport?: (transport: "direct" | "buffered") => void,
): Promise<string> {
  const generation = getAuthGeneration();
  assertAudioWithinLimit(pcm);
  assertAuthGeneration(generation, signal);
  if (isAsrQuotaCooling()) throw new AsrQuotaError();
  const interactionId = getInteraction(signal);
  let fallbackReason: AsrFallbackReason = "unknown";
  const directStarted = performance.now();
  onTransport?.("direct");
  try {
    const text = await transcribeDirect(pcm, signal);
    assertAuthGeneration(generation, signal);
    reportTiming("asr.attempt", performance.now() - directStarted, {
      engine: "xfyun", transport: "direct", interactionId, stage: "whole_clip", attempt: 1,
      audio_bytes: pcm.byteLength, outcome: text.trim() ? "ok" : "error",
      result_class: text.trim() ? "nonempty" : "empty",
    });
    return text;
  } catch (error) {
    if (isAsrQuotaError(error)) throw error;
    fallbackReason = asrFallbackReason(error);
    const cancelled = signal?.aborted || generation !== getAuthGeneration() ||
      ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError");
    reportTiming("asr.attempt", performance.now() - directStarted, {
      engine: "xfyun", transport: "direct", interactionId, stage: "whole_clip", attempt: 1,
      audio_bytes: pcm.byteLength, outcome: cancelled ? "cancelled" : "error", fallback_reason: fallbackReason,
    });
    assertAuthGeneration(generation, signal);
    signal?.throwIfAborted();
    if ((error instanceof Error || error instanceof DOMException) && error.name === "AbortError") throw error;
    if (isAsrQuotaCooling()) throw new AsrQuotaError();
  }
  const bufferedStarted = performance.now();
  onTransport?.("buffered");
  try {
    const res = await fetch(`${BASE_URL}/api/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", ...traceHeaders(signal) },
      body: pcm,
      signal: withTimeout(signal, 45_000),
    });
    assertAuthGeneration(generation, signal);
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.clone().json() as { detail?: unknown };
        detail = typeof body.detail === "string" ? body.detail : "";
      } catch { /* non-JSON provider error */ }
      const provider = detail.match(/iFlytek ASR error (\d+)/);
      if (provider) throw asrProviderError(Number(provider[1]), detail);
      throw new Error(`asr failed: ${res.status}`);
    }
    const data = (await res.json()) as { text: string };
    assertAuthGeneration(generation, signal);
    reportTiming("asr.attempt", performance.now() - bufferedStarted, {
      engine: "xfyun", transport: "buffered", interactionId, stage: "http_buffered", attempt: 2,
      audio_bytes: pcm.byteLength, outcome: data.text.trim() ? "ok" : "error",
      result_class: data.text.trim() ? "nonempty" : "empty", fallback_reason: fallbackReason,
    });
    return data.text;
  } catch (error) {
    assertAuthGeneration(generation, signal);
    reportTiming("asr.attempt", performance.now() - bufferedStarted, {
      engine: "xfyun", transport: "buffered", interactionId, stage: "http_buffered", attempt: 2,
      audio_bytes: pcm.byteLength, outcome: signal?.aborted ? "cancelled" : "error", fallback_reason: fallbackReason,
    });
    throw error;
  }
}

export interface PhonemeScore {
  label: string;
  ok: boolean;
}

export interface WordScore {
  word: string;
  score: number;
  phonemes?: PhonemeScore[];
}

export interface PronunciationResult {
  overall: number;
  accuracy: number;
  fluency: number;
  integrity: number;
  standard: number;
  words: WordScore[];
}

/** Score how well the given 16 kHz PCM reads `text` (iFlytek ISE). */
export async function postPronunciation(
  text: string,
  pcm: ArrayBuffer,
  signal?: AbortSignal,
  entry?: "turn_correction" | "follow_read",
): Promise<PronunciationResult> {
  const generation = getAuthGeneration();
  assertAudioWithinLimit(pcm);
  const query = new URLSearchParams({ text });
  if (entry) query.set("entry", entry);
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...traceHeaders(signal) },
    body: pcm,
    signal: withTimeout(signal, 45_000),
  };
  assertAuthGeneration(generation, signal);
  const res = await fetch(`${BASE_URL}/api/pronunciation?${query.toString()}`, init);
  assertAuthGeneration(generation, signal);
  if (!res.ok) throw new Error(`pronunciation failed: ${res.status}`);
  const result = (await res.json()) as PronunciationResult;
  assertAuthGeneration(generation, signal);
  return result;
}

/** Suggest a few natural things the learner could say next. */
export async function postHint(
  scenarioId: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  custom?: CustomScene,
): Promise<string[]> {
  const res = await fetch(`${BASE_URL}/api/hint`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id: scenarioId, messages: messages.slice(-40), custom }),
    signal: withTimeout(signal, 15_000),
  });
  if (!res.ok) throw new Error(`hint failed: ${res.status}`);
  const data = (await res.json()) as { suggestions: string[] };
  return data.suggestions;
}

export interface DailyLine {
  text: string;
  author: string;
  zh: string;
  usage?: string;
}

/** Ask DeepSeek for a fresh batch of short lines to shadow. */
export function getDailyLines(n = 5, signal?: AbortSignal): Promise<DailyLine[]> {
  return request<{ lines: DailyLine[] }>(`/api/daily-lines?n=${n}`, { signal }).then(
    (r) => r.lines,
  );
}

export interface InterviewResult {
  question: string;
  answer: string;
  score: number;
  level: string;
  feedback: string;
  sample_answer: string;
  sample_source?: "video_reference" | "ai_generated";
  sample_source_url?: string | null;
  sample_word_count?: number;
  sample_estimated_seconds?: number;
  reference_notes?: string | null;
  reference_answers?: string[];
}

export interface InterviewScore {
  overall: number;
  results: InterviewResult[];
  score_max?: 5 | 6;
  scoring_version?: string;
  scoring_basis?: "transcript";
}

export type InterviewCollection = "inspire" | "ets";
export type InterviewSource = InterviewCollection | "all";
export interface InterviewSetSummary {
  id: string;
  collection: InterviewCollection;
  episode: number | null;
  topic: string;
  topic_en: string;
  intro: string;
  question_count: number;
  source_title: string;
  source_url: string;
  source_kind: string;
  reviewed_at: string;
}
export interface InterviewDeck extends Omit<InterviewSetSummary, "id" | "question_count"> {
  set_id: string;
  questions: string[];
  hints: string[];
}
const INTERVIEW_SETS_TTL_MS = 5 * 60_000;
let interviewSetsCache: { at: number; sets: InterviewSetSummary[] } | null = null;
export function getInterviewSets(signal?: AbortSignal): Promise<InterviewSetSummary[]> {
  if (interviewSetsCache && Date.now() - interviewSetsCache.at < INTERVIEW_SETS_TTL_MS) {
    return Promise.resolve(interviewSetsCache.sets);
  }
  return request<{ sets: InterviewSetSummary[] }>("/api/interview/sets", { signal }).then(r => {
    interviewSetsCache = { at: Date.now(), sets: r.sets };
    return r.sets;
  });
}
export function getInterviewSet(
  setId?: string,
  signal?: AbortSignal,
  source: InterviewSource = "inspire",
): Promise<InterviewDeck> {
  const params = new URLSearchParams({ n: "4", ai: "false", source });
  if (setId) params.set("set_id", setId);
  return request<InterviewDeck>("/api/interview/questions?" + params.toString(), { signal });
}

/** Take an Interview questions for the timed four-question drill. */
export function getInterviewQuestions(n = 4, signal?: AbortSignal): Promise<string[]> {
  return request<{ questions: string[] }>(`/api/interview/questions?n=${n}`, { signal }).then(
    (r) => r.questions,
  );
}

/** Evaluate transcript language and organization; return practice feedback and samples. */
export function scoreInterview(
  items: { question: string; answer: string }[],
  signal?: AbortSignal,
  setId?: string,
): Promise<InterviewScore> {
  return request<InterviewScore>("/api/interview/score", {
    method: "POST",
    body: JSON.stringify({ items, set_id: setId }),
    signal,
  });
}

export interface PracticeRecord {
  id: number;
  kind: string;
  score: number;
  score_max?: number;
  title: string;
  created_at: string;
}

export interface PracticeDetail extends PracticeRecord { detail: string; }
export function getPracticeDetail(id: number, signal?: AbortSignal): Promise<PracticeDetail> {
  return request<PracticeDetail>(`/api/practice/${id}`, { signal });
}

export interface Stats {
  earned_badges?: string[];
  timezone?: string;
  local_date?: string;
  streak_days: number;
  today_count: number;
  today_goal: number;
  level: number;
  xp: number;
  xp_to_next: number;
  total_sessions: number;
  total_practice: number;
  words_count: number;
}

/** Save one practice result (pronunciation score / timed-Q&A result). */
export function savePractice(
  kind: string,
  score: number,
  title = "",
  detail = "",
  signal?: AbortSignal,
  clientRequestId?: string,
): Promise<PracticeRecord> {
  return request<PracticeRecord>("/api/practice", {
    method: "POST",
    body: JSON.stringify({ kind, score, title, detail, client_request_id: clientRequestId }),
    signal,
  });
}

export function getPractice(kind?: string, limit = 100, signal?: AbortSignal, force = false): Promise<PracticeRecord[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (kind) q.set("kind", kind);
  return readMetadata<PracticeRecord[]>(`/api/practice?${q.toString()}`, signal, force);
}

/** Real activity stats: streak, level/XP, today vs goal, totals. */
export function getStats(signal?: AbortSignal, force = false): Promise<Stats> {
  return readMetadata<Stats>("/api/stats", signal, force);
}

export interface SkillInsight {
  key: string;
  label_zh: string;
  label_en: string;
  avg: number; // mean score over recent sessions, 0-100
  delta: number; // later-half avg minus earlier-half avg (>0 improving)
  samples: number;
}

export interface Insights {
  available: boolean;
  sessions: number;
  overall_delta: number;
  weakest: SkillInsight | null;
  strongest: SkillInsight | null;
  skills: SkillInsight[]; // weakest first
}

/** Cross-session ability analysis: weakest dimension to focus on + per-skill trend. */
export function getInsights(signal?: AbortSignal, force = false): Promise<Insights> {
  return readMetadata<Insights>("/api/stats/insights", signal, force);
}

export interface ProgressSessions {
  sessions: SessionSummary[];
  insights: Insights;
  latest: { id: number; scores: SkillScore[] } | null;
}

export function getProgressSessions(signal?: AbortSignal, force = false): Promise<ProgressSessions> {
  return readMetadata<ProgressSessions>("/api/progress/sessions", signal, force);
}

export interface Word {
  id: number;
  text: string;
  meaning: string;
  example: string;
  scenario_id: string;
  kind: string; // "word" | "sentence"
  mastered: boolean;
  created_at: string;
  box?: number; // spaced-repetition Leitner box
  due_at?: string | null;
  last_reviewed?: string | null;
}

export function getWords(signal?: AbortSignal): Promise<Word[]> {
  return request<Word[]>("/api/words", { signal });
}

export function postWord(
  payload: {
    text: string;
    scenario_id?: string;
    meaning?: string;
    example?: string;
    kind?: string;
  },
  signal?: AbortSignal,
): Promise<Word> {
  return request<Word>("/api/words", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

/** Words whose spaced-repetition review is due (not yet mastered). */
export function getDueWords(kind?: string, signal?: AbortSignal): Promise<Word[]> {
  const q = kind ? `?kind=${kind}` : "";
  return request<Word[]>(`/api/words/due${q}`, { signal });
}

/** Record an SRS review: remembered pushes the next review out, forgot resets it. */
export function reviewWord(id: number, remembered: boolean, signal?: AbortSignal, clientRequestId?: string): Promise<Word> {
  return request<Word>(`/api/words/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ remembered, client_request_id: clientRequestId }),
    signal,
  });
}

export function patchWord(id: number, mastered: boolean, signal?: AbortSignal): Promise<Word> {
  return request<Word>(`/api/words/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ mastered }),
    signal,
  });
}

export async function deleteWord(id: number, signal?: AbortSignal): Promise<void> {
  const generation = getAuthGeneration();
  const headers = { "X-Client-Id": getClientId(), "X-Timezone": deviceTimezone(), ...authHeader() };
  if (generation !== getAuthGeneration()) throw new DOMException("Account changed", "AbortError");
  const res = await fetch(`${BASE_URL}/api/words/${id}`, { method: "DELETE", headers, signal });
  if (generation !== getAuthGeneration()) throw new DOMException("Account changed", "AbortError");
  if (!res.ok) throw new Error(`delete word failed: ${res.status}`);
  invalidateProgress();
}

// --- Accounts (optional; the app also works anonymously per-device) ---

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  is_admin?: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

/** Create an account; binds the current device's anonymous data to it. */
export function registerUser(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    signal,
  });
}

/** Log in to an existing account. */
export function loginUser(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    signal,
  });
}

/** The authenticated account; rejects if the token is missing or expired. */
export function getMe(signal?: AbortSignal): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me", { signal });
}

/** Edit the logged-in account's display name and/or avatar (a small data URL). */
export function updateProfile(
  patch: { display_name?: string; avatar_url?: string },
  signal?: AbortSignal,
): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
    signal,
  });
}
