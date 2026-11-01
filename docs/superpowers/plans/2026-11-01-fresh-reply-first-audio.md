# Fresh Reply First Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Locate and reduce new dialogue generation/browser-start waiting without paid configuration or feature regressions.

**Architecture:** Safe stream stage/token evidence guides bounded prompt tuning. Independent voice discovery spans text generation; native attempt outcomes expose silent failures, and correct paused-state recovery and nonblocking stream cleanup remove avoidable waiting.

**Tech Stack:** Python3.11/FastAPI/HTTPX; React/TypeScript/Vitest/Node20.

**Spec:** docs/superpowers/specs/2026-11-01-fresh-reply-first-audio-design.md

## Global Constraints

- Original free hosting, model/providers, thinking disabled, max_tokens/history window; one whole native utterance/WAV, no sentence streaming or speculative synthesis.
- No further browser/computer automation this turn after URL-verification stop. CLI/API tests are independent; never call synthetic callbacks real hardware evidence.
- Fixed numeric/enum diagnostics only, native voice classification rather than name/URI; no user content/keys/URLs/identities in telemetry.
- Native five-second startup guard retained; preserve mute/replay/retry, independent cancellation, ownership, permanent progress and scoring/history.
- Explicit scoped commits, exact EthanLyu30 <2454472858@qq.com>; no .env/realDB/provider calls, deletion, subagents or main push by implementers. Root owns provider experiments/public baseline/release/report/cleanup and serialized commit windows.

## Review Focus

- Native failure followed by successful cloud must expose the failed attempt without duplicate playback or falsely counting started cancellation as startup failure.
- Preparation must not cancel a manually replayed message or freeze pre-request voice preferences; typing send completion must not wait for playback.
- Auth/unmount/mute/retry changes must release voice listeners and reject old results, including fallback and aborted streams.
- A completed SSE frame must not wait for stalled cancel(), while partial/error streams still fail and retain their original cause.
- Concise routine replies must retain essential scene information, warmth, explicit language help and context; no max-token truncation masquerading as speed.

### Task 1: Model timing, bounded native diagnostics and evidence-guided dialogue tuning

**Files:** backend/app/services/{deepseek,dialogue}.py, core/{performance,observability}.py, api/{chat,telemetry}.py, schemas/telemetry.py, focused tests.

- [x] Root records the public pre-change new-reply and Node Fetch baseline. Add failing tests for last-text/tail/done timing, bounded cache hit/miss usage counters, safe optional done timings and native-attempt enum/state fields. Existing clients ignore optional done data and older telemetry bodies remain valid.
- [x] Add last-delta/done timings and provider usage visibility, enabling documented stream usage where needed. Keep `[DONE]` completion and reject explicit unsuccessful stream finish reasons; preserve partial-error behavior and all non-dialogue callers. No raw error/content data enters diagnostics.
- [x] Define routine prompt candidate; root performs paired old/new provider evaluation before adoption. Preserve shared policy exactly, untrusted scene isolation, forty-message history, max_tokens300 and temperature. Only adopt a smaller natural reply style when contextual/help examples and measured generation results support it; otherwise keep original prompt and document the outcome.
- [x] Extend browser telemetry with native_start-only optional fields: reason, bounded standard error code, state_before/state_after three-bit masks, classified voice_type and explicit-voice match flag. Fixed names/values only. Persist them into the existing bounded browser span and test unknown/content fields remain rejected.
- [x] Focused backend tests and self-review; full backend deferred to one coherent Task2 gate. Commit explicit paths after root grants window. Report task-1-report.md in the plan workspace.

### Task 2: New-reply preparation, native recovery and client completion boundaries

**Files:** frontend/src/lib/{speech,voiceResolver,chatStream,api,telemetry}.ts, pages/Conversation.tsx, Admin labels if needed, focused tests; no backend edits without coordination.

- [x] Reproduce delayed reader.cancel completion with a valid done frame and actual Fetch timing where available. Safely initiate cleanup without awaiting it before delivering accepted final text; preserve abort/error/partial/UTF-8 behavior and avoid unhandled rejection/lock leaks.
- [x] Add a disposable voice preparation separate from global active playback. Start before typed/push-to-talk model requests and plain fallbacks; consume in existing final autoplay path, correlate opaque interaction IDs, and keep manual replay during generation, current preferences, mute/unmount/auth cleanup and send completion intact. No speech/audio fetch until final text.
- [x] Resume a paused native synthesizer before speaking; avoid redundant idle cancel if safe, preserve selected voice/limits and one utterance. Record one native_start outcome and fixed reason/state metadata on success, pre-start errors, no-start timeout, exceptions and cancellation. Started speech never replays in cloud. Emit client model first/last/done and request-to-start evidence with original metrics unchanged.
- [x] Cover meaningful typed/call/fallback/mute/replay/auth/preference transitions and native failures with regression tests. Then run one coherent full backend/frontend/lint/typecheck/build gate after holding source stable with root. Commit explicit paths after serialized window; report task-2-report.md.

### Task 3: Final comparison, acceptance, main release and cleanup

Root orchestration.

- [x] Review each task plus one fresh whole-branch review. Address important findings through scoped fix/re-review; keep model experiments and actual/synthetic/browser evidence separate.
- [x] Compare same synthetic fresh replies/history via live endpoints; preserve all samples/errors, first/last/done/word counts and remaining native/hardware gaps. No opening-cache benefit in the primary results. No production learning writes.
- [x] Verify protected hashes, source identity, full coherent gates, then merge/push main already authorized. Verify Python3.11/Node20 CI, Render/Vercel and frontend release.
- [x] Retain final source/spec/plan/comparison only. Safely clean verified scratch/build/pytest/Vite/bytecode artifacts and report any cleanup blocked by browser policy. No force push, user-input deletion or host-owned worktree removal.
