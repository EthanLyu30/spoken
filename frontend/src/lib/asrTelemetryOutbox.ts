import { ASR_FALLBACK_REASONS, ASR_OPERATIONS, ASR_REASONS, ASR_STAGES } from "./asrDiagnostics";

const KEY_PREFIX = "spoken-asr-telemetry:v1:";
const ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_PENDING = 64;
const RETENTION_MS = 24 * 60 * 60_000;
const INITIAL_RETRY_MS = 750;
const MAX_RETRY_MS = 60_000;

type Payload = Record<string, unknown>;
type Pending = { key: string; createdAt: number; payload: Payload };
type Send = (payload: Payload) => Promise<Response | undefined>;

const object = (value: unknown): Payload | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Payload : undefined;
const choice = (value: unknown, allowed: readonly string[]) =>
  typeof value === "string" && allowed.includes(value) ? value : undefined;
const text = (value: unknown, pattern: RegExp) => typeof value === "string" && pattern.test(value) ? value : undefined;
const number = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const integer = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) ? number(value, min, max) : undefined;

/** Rebuild only the bounded diagnostic fields when restoring browser storage. */
function failurePayload(value: unknown): Payload | undefined {
  const raw = object(value);
  if (!raw) return;
  const operation = choice(raw.operation, ASR_OPERATIONS);
  const outcome = choice(raw.outcome, ["error", "timeout"]);
  const eventId = text(raw.event_id, ID_PATTERN);
  const duration = number(raw.duration_ms, 0, 300_000);
  if (!operation || !outcome || !eventId || duration === undefined) return;

  const payload: Payload = {
    operation, outcome, event_id: eventId, duration_ms: duration,
    release: text(raw.release, /^[A-Za-z0-9._-]{1,80}$/) ?? "unknown",
    engine: choice(raw.engine, ["local", "xfyun", "browser", "unknown"]) ?? "unknown",
    transport: choice(raw.transport, ["direct", "relay", "buffered", "local", "unknown"]) ?? "unknown",
    interaction_id: text(raw.interaction_id, ID_PATTERN),
    test_run_id: text(raw.test_run_id, /^[A-Za-z0-9._-]{1,64}$/),
    asr_reason: choice(raw.asr_reason, ASR_REASONS),
    provider_code: integer(raw.provider_code, 1, 99_999),
  };

  if (operation === "asr.attempt") {
    const stage = choice(raw.stage, ASR_STAGES);
    const attempt = integer(raw.attempt, 1, 10);
    const audioBytes = integer(raw.audio_bytes, 0, 5_760_000);
    if (!stage || attempt === undefined || (["whole_clip", "http_buffered"].includes(stage) && audioBytes === undefined)) return;
    Object.assign(payload, {
      stage, attempt, audio_bytes: audioBytes,
      fallback_reason: choice(raw.fallback_reason, ASR_FALLBACK_REASONS),
      result_class: choice(raw.result_class, ["empty", "nonempty"]),
    });
  }
  return payload;
}

function pendingFailures(storage: Storage): Pending[] {
  const keys = Object.keys(storage).filter(key => key.startsWith(KEY_PREFIX));
  const now = Date.now();
  const expiresBefore = now - RETENTION_MS;
  const pending: Pending[] = [];
  for (const key of keys) {
    const raw = storage.getItem(key);
    let entry: Payload | undefined;
    try { entry = raw && raw.length <= 2048 ? object(JSON.parse(raw)) : undefined; }
    catch { /* Discard malformed entries from this queue. */ }
    const payload = failurePayload(entry?.payload);
    const createdAt = number(entry?.createdAt, 0, now + RETENTION_MS);
    if (payload && key === KEY_PREFIX + payload.event_id && createdAt !== undefined && createdAt > expiresBefore) {
      pending.push({ key, createdAt, payload });
    } else {
      storage.removeItem(key);
    }
  }
  return pending.sort((a, b) => a.createdAt - b.createdAt);
}

export function retryAfterMs(response?: Response): number {
  const seconds = Number(response?.headers?.get("Retry-After") ?? 60);
  return Math.max(1, Math.min(60, Number.isFinite(seconds) ? seconds : 60)) * 1000;
}

/** Keep one stable key per event so one tab never replaces another tab's queue. */
export function createAsrTimingOutbox(send: Send) {
  let stopped = false;
  let sending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = INITIAL_RETRY_MS;
  let networkRetryAt = 0;
  let rateLimitUntil = 0;

  async function deliver(storage: Storage, entry: Pending) {
    const response = await send(entry.payload).catch(() => undefined);
    try {
      if ((response?.ok && response.headers.get("X-Telemetry-Stored") === "1") ||
          [400, 413, 422].includes(response?.status ?? 0)) {
        storage.removeItem(entry.key);
        retryDelay = INITIAL_RETRY_MS;
        return;
      }
    } catch { /* A blocked storage operation is retried with backoff. */ }
    if (response?.status === 429) {
      rateLimitUntil = Date.now() + retryAfterMs(response);
    } else {
      networkRetryAt = Date.now() + retryDelay;
      retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2);
    }
  }

  function flush() {
    if (stopped || sending) return;
    clearTimeout(timer);
    let storage: Storage;
    let entry: Pending | undefined;
    try {
      storage = window.localStorage;
      [entry] = pendingFailures(storage);
    } catch { return; }
    if (!entry || navigator.onLine === false) return;

    const wait = Math.max(networkRetryAt, rateLimitUntil) - Date.now();
    if (wait > 0) {
      timer = setTimeout(flush, wait);
      return;
    }

    sending = true;
    void deliver(storage, entry).finally(() => {
      sending = false;
      flush();
    });
  }

  function online() {
    networkRetryAt = 0;
    flush();
  }

  window.addEventListener("online", online);
  window.addEventListener("pageshow", flush);
  flush();
  return {
    enqueue(value: Payload): boolean {
      const payload = failurePayload(value);
      if (!payload || stopped) return false;
      try {
        const storage = window.localStorage;
        const older = pendingFailures(storage);
        for (const entry of older.slice(0, Math.max(0, older.length - MAX_PENDING + 1))) {
          storage.removeItem(entry.key);
        }
        storage.setItem(KEY_PREFIX + payload.event_id, JSON.stringify({ createdAt: Date.now(), payload }));
      } catch { return false; }
      flush();
      return true;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("pageshow", flush);
    },
  };
}
