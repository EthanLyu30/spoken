# Cloud Speech Preconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Overlap cloud connection setup with fresh reply generation while preserving whole audio and current fallback behavior.

**Architecture:** A lifespan-owned bounded pool issues one-use preparation tickets. The original TTS endpoint consumes only already-ready sockets; browser preparation never waits for a ticket after final text.

**Tech Stack:** Existing Python asyncio/FastAPI/websockets and TypeScript/React/Vitest; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-cloud-speech-preconnect-design.md`

## Global Constraints

- Pool: 4 unconsumed preparations maximum, 4-second TTL from reserve, 4 starts/second maximum.
- Tickets: random 32-character hexadecimal values, one use, no provider credentials returned.
- Pending/missing/failed preparations never delay ordinary synthesis.
- Keep complete PCM/WAV, original final-frame checks, one text submission, current voices/preferences and 30-second synthesis timeout.
- Existing browser/local priorities, auth/abort/mute behavior, history and paid configuration remain.

## Review Focus

- Cancellation during handshake or during shutdown must not leave an entered socket unclosed.
- A just-finished or closed socket must not be consumed twice or wait on preparation.
- A late English voice or a newly selected cloud voice must win over the preparation snapshot.
- Missing prepare support and request failures must leave the original TTS request usable.
- Shared cache hits and failed synthesis must release prepared resources exactly once.

---

### Task 1: Bounded ready-only connection pool and TTS integration

**Files:**
- Create `backend/app/services/tts_warmup.py`, `backend/tests/test_tts_warmup.py`.
- Modify `backend/app/services/xf_tts.py`, `backend/app/api/tts.py`, `backend/app/schemas/tts.py`, `backend/app/main.py`, `backend/app/core/performance.py`.
- Extend `backend/tests/test_tts.py` and `backend/tests/test_performance.py`.

**Interfaces:**
- `TtsWarmupPool.reserve(factory) -> str | None`, `take(ticket) -> PreparedConnection | None`, `discard(ticket) -> None`, `close() -> awaitable`.
- `PreparedConnection` is an async context manager for one already-open provider connection, with numeric age/connect diagnostics.
- `XfTtsClient.connection()` returns the existing provider connection context; `synthesize_stream(..., connection=None)` may consume a prepared context once.
- `POST /tts/prepare -> {ticket: string}`; `/tts` optionally consumes `warmup_ticket`.

- [x] Write pool and integration tests proving ready sockets work, pending sockets fall through immediately, duplicate/expired/failed/closed tickets fall through, capacity/rate admission is bounded and shutdown closes both connecting/ready sockets.
- [x] Run tests and observe missing pool/preparation failures before implementation.
- [x] Implement the bounded resource owner and reuse original synthesis protocol with an optional connection context.
- [x] Verify same exact PCM and voice/speed/pitch behavior; missing optional fields retain legacy behavior; cache hits discard tickets.
- [x] Run focused and full backend suites, then commit the reviewed backend change.

### Task 2: Disposable new-reply cloud preparation

**Files:**
- Create `frontend/src/lib/cloudSpeechPreparation.ts` and `.test.ts`.
- Modify `frontend/src/lib/speech.ts`, `frontend/src/lib/api.ts`, `frontend/src/pages/Conversation.tsx` (already-muted preparation gate).
- Extend `frontend/src/lib/speechWholeReply.test.ts`; keep existing Conversation regression tests real.

**Interfaces:**
- `prepareCloudSpeech(signal?) -> { take(): string | undefined; dispose(): void }`.
- `fetchTtsUrl(text, scenarioId?, signal?, overrides?, warmupTicket?)`.
- `SpeechPreparation.takeCloudTicket()` provides a synchronous one-shot optional ticket and preserves existing consume/dispose contracts.

- [x] First write and run failing tests: ready ticket once; pending ticket no wait; failed/old backend no ticket; aborted/disposed ticket unusable.
- [x] Implement prepare POST with a 1500 ms timeout and no auth/content payload; disposal detaches parent abort listeners.
- [x] First write and run failing integration tests: preparation during model wait only for expected cloud; late Natural voice and current voice preferences win; stop/mute prevents TTS; one complete audio request retains latest text.
- [x] Wire to existing independent preparation and complete-audio fetch, without changing immediate replay/preview defaults.
- [x] Run full frontend tests, lint, typecheck and build, then commit the reviewed frontend change.

### Task 3: Production comparison and real-chat acceptance

**Files:**
- Update `docs/performance/2026-11-01-in-app-new-chat-acceptance.md` with before/after evidence and limits.
- Keep this plan's completion flags accurate.

- [x] Fresh review of changed resource/abort paths; resolve findings and rerun affected checks.
- [ ] Verify commit identity EthanLyu30; preserve primary checkout's original nine changes by hashing before/after integration.
- [ ] Verify server/client deployments before measurement; baseline omission and ready ticket comparison run against the same deployed backend.
- [ ] Measure fixed complete texts in alternating arms (three texts, two rounds); retain misses/errors rather than selecting only hits.
- [ ] Measure genuinely generated new replies and compare total model-plus-cloud file readiness separately from browser callbacks.
- [x] Continue in-app real chat acceptance, distinguishing effective speech engine and actual output from onplaying/onstart.
- [ ] Update report; clean exact task-generated artifacts after verification. Main push requires the requested acceptance; an unavailable required browser/audio check remains outstanding, not silently treated as passed.
