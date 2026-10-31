# Whole Reply Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sentence/chunk playback with one complete utterance per reply, defaulting to browser speech.

**Architecture:** Preserve the existing `SpeechQueue` interface for conversation callers, but buffer `feed` and start a single engine operation at `end`. Reuse this path for `speakText`, keep current telemetry events and cancellation contracts, and migrate old voice preferences.

**Tech Stack:** Existing React/TypeScript/Zustand/Web Speech/HTMLAudio; existing XFYun and optional Kokoro services. No new packages or credentials.

**Spec:** `docs/superpowers/specs/2026-10-31-whole-reply-speech-design.md`

## Global Constraints

- Browser whole-reply speech is the user-selected default; cloud and explicit local options remain.
- No sentence playback or PCM scheduling in current read-aloud paths.
- Preserve ASR, scoring, history, interruption, stop, retry, and private admin authorization.
- Keep measured timings and release/interaction metadata; do not manufacture production samples.
- Preserve user-owned dirty files and remove task-only artifacts after verification.

## Review Focus

- Cancel before final text: no synthesis or playback.
- Cancel after audio fetch: abort and release late object URLs.
- Stop an already completed browser task: never cancel its successor.
- Local model readiness changes: never switch voices inside one reply.
- Native synthesis errors or missing voices: settle honestly and preserve a whole-audio fallback when no voice is available.

### Task 1: Deliver whole-reply speech

**Files:** Modify `frontend/src/lib/speech.ts`, `frontend/src/store/voice.ts`, `frontend/src/pages/Profile.tsx`, `frontend/src/pages/Conversation.tsx`; update speech/voice tests, admin labels and observability docs.

**Interfaces:** Keep `Speaking` and `SpeechQueue` callers compatible; optional failure status may be exposed to `speakText`. Consume unchanged `fetchTtsUrl`, `resolveVoiceMode`, Kokoro, and telemetry APIs.

- [x] Add failing behavioral tests: no `feed` playback, one multi-sentence native utterance / cloud audio, final-text replacement, stop before/after sound, errors, resource disposal and unchanged timing boundaries.
- [x] Add migration tests exercising persisted old preferences and default voice resolution.
- [x] Run tests and observe intended failures before replacing sentence scheduling.
- [x] Implement single playback dispatch at `end`, reuse for one-shot speech, freeze engine for the utterance, and preserve cleanup and measurement.
- [x] Update defaults/migration and user-facing whole-reply labels without promising uniform voice quality.
- [x] Run full frontend/backend tests, lint, typecheck and production build; request one fresh read-only review.
- [x] Commit as EthanLyu30, fast-forward/push main preserving unrelated changes, and verify deployment.
- [ ] Verify real native / whole-cloud playback callbacks. Edge exposed voices but ended without start; the fix adds a whole-file fallback. Further browser control was stopped by the tool because the Windows browser URL could not be determined reliably. Do not claim listening acceptance.
- [x] Remove temporary test sources, audio, logs and servers; retain project docs. Older build/test caches and old task artifacts whose deletion was previously blocked remain preserved; that cleanup is not reported as complete.

## Implementation verification

- Frontend: 239 tests across 48 files; backend: 412 tests; ESLint, TypeScript and production build passed.
- Independent review identified missing native callback deadlines and the old 800-character cloud contract. Both were reproduced with failing tests and fixed in one pass. Coverage includes cancelled startup, late callbacks, incomplete playback without automatic replay, a complete reply over 800 characters, and UTF-8 provider boundaries.
- Real Edge listed 47 online English voices and zero local English voices; the original native test ended without a start event. This is a failed playback attempt, not acceptance. Browser tooling subsequently stopped because it could not reliably determine the Windows URL. No physical playback or hearing acceptance is claimed.

## Release verification (2026-10-31)

- Functional release `3c5bb40` is on `main`; both GitHub CI jobs passed. The served `www.spokenai.org` entry contains this release SHA, the browser-default store configuration and the whole-reply voice settings text.
- Render deployment `7458644872` for the same SHA reported success; backend health is healthy and the public TTS schema exposes the new provider-bounded input contract.
- One actual production API request submitted an 878-character English reply and returned HTTP 200 with a complete 16 kHz, mono, 16-bit WAV. Response time was 5.11 seconds and encoded audio duration was 84.82 seconds. These are file-response and media-duration checks, not measured browser first sound or physical playback.
- The primary checkout's nine unrelated modified/untracked files retained their SHA-256 hashes through integration. The task's temporary helper sources, 13 scratch files and server were removed; port 5189 has no listener. No alternative UI control was used after the browser tool stopped.
