# Natural voice latency repair implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore natural browser speech, eliminate measured cloud shutdown waiting, and make local speech truthful and recoverable.

**Architecture:** Keep whole-reply playback, add non-persisted playback status, and expose the existing local coordinator through stable subscribed snapshots. Reuse existing suppliers, libraries and voice preferences.

**Tech Stack:** React 18, Zustand, TypeScript, Web Speech, current model workers, FastAPI/websockets.

**Spec:** `docs/superpowers/specs/2026-10-31-natural-voice-latency-repair-design.md`

## Global Constraints

- No sentence/PCM client assembly, new suppliers, keys or packages.
- User voice preference wins; default prioritizes natural English voices.
- Actual engine and fallback must be visible. Local mode is experimental, not offline chat.
- TTS/ASR inference budgets: 2 seconds / 5 seconds; complete audio and cancellation remain correct.
- Preserve user modifications, authorization, scoring, history and explicit local mode.

## Review Focus

- A stopped/replaced task must not overwrite the successor's playback status.
- Browser English voice availability must not be confused with a successfully started voice.
- Closing a completed upstream socket must not discard audio or conceal incomplete synthesis.
- Retrying a failed local model must not reuse a rejected promise or dead worker.
- Local readiness for pronunciation and recognition can differ and must be shown independently.

### Task 1: Natural voice preference and truthful playback status

**Files:** `frontend/src/lib/speech.ts`, new `frontend/src/store/speechPlayback.ts`, `frontend/src/pages/Profile.tsx`, new `frontend/src/components/SpeechPlaybackStatus.tsx`, conversation status and speech/profile tests.

- [x] Add failing behavioral tests for natural voice preference, explicit preference, actual fallback state, errors and stale task updates; observe RED.
- [x] Restore natural voice priority and publish non-persisted effective engine, voice, reason and phase while keeping whole-reply cancellation/telemetry.
- [x] Surface status and preview errors in settings/conversation; run focused tests and commit.

### Task 2: Return complete cloud audio without shutdown waiting

**Files:** `backend/app/services/xf_tts.py`, `backend/tests/test_tts.py`.

- [x] Add a delayed-close integration regression that fails with the old shutdown budget while checking complete PCM and provider completion.
- [x] Limit close timeout to 150 ms; verify complete/incomplete/cancel behavior and repeat the actual supplier timing comparison.
- [x] Run backend suite and commit.

### Task 3: Complete local speech lifecycle

**Files:** coordinator/bootstrap/runtime, worker client and model loaders, transcribe/speech fallback, new `frontend/src/components/LocalSpeechStatus.tsx`, profile and local tests.

- [x] Add failing tests for subscribed progress/state, failed load retry, Kokoro priority, inference timeout/disposal and separate model readiness; observe RED.
- [x] Implement snapshots/progress/retry, clear failed model promises, bound inference waits, and prefer browser speech while local TTS is unavailable.
- [x] Show experimental purpose, download/readiness/errors and retry in settings; run focused tests and commit.

**Measured evidence (2026-10-31):** For the same short English text, the original supplier-direct run took 1,389 ms (last audio 354 ms, close handshake 1,035 ms). A controlled 150 ms close budget took 429 ms with identical 138,630-byte PCM and digest. The actual repaired source repeated successfully in 322 ms (first audio 125 ms, last audio 155 ms, same byte count); a preceding attempt failed transiently, so this does not establish network reliability or production first-sound latency. Browser preferences now prioritize natural English voices; physical Chrome playback and actual model download/inference remain unverified because Computer Use could not determine the Chrome URL and stopped UI control.

### Release and acceptance

- [x] Full frontend/backend tests, lint, TypeScript and production build; one fresh read-only branch review, one TDD fix pass if required.
- [ ] Preserve the primary checkout's nine unrelated files, integrate and push main as EthanLyu30, verify CI and public deployment.
- [ ] Measure real Chrome native speech if browser access permits; measure cloud first sound separately from media duration. Do not claim physical hearing from callbacks.
- [ ] Remove owned diagnostic artifacts after verification, preserve final evidence and report previously blocked caches.

**Review and release evidence:** One independent review found an interrupted-preload bug: re-enabling local mode after Kokoro finished while disabled could leave Moonshine idle. The regression `resumes recognition preparation when re-enabled after pronunciation finished while disabled` failed before the fix and passed after making bootstrap restartable and limiting automatic scheduling to engine transitions. Full frontend: 258/258; backend: 413/413; lint, TypeScript and production build passed. Physical Chrome and real local model performance remain outside automatic acceptance. Before release, the old live cloud endpoint returned one 35-second read timeout, followed by successful complete WAVs in 4.53 and 3.82 seconds; warmed health latency was 0.32 seconds. The cloud shutdown fix does not establish that all production network delays have been eliminated.
