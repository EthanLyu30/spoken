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
- [ ] Run full frontend/backend tests, lint, typecheck and production build; request one fresh read-only review.
- [ ] Commit as EthanLyu30, fast-forward/push main preserving unrelated changes, and verify deployment.
- [ ] Verify real native / whole-cloud playback callbacks. Edge exposed voices but ended without start; the fix adds a whole-file fallback. Further browser control was stopped by the tool because the Windows browser URL could not be determined reliably. Do not claim listening acceptance.
- [ ] Remove temporary test sources, audio, logs and servers; retain final screenshots and project docs.
