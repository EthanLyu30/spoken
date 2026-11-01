# Browser Speech and First-text Diagnostics Implementation Plan

> **For agentic workers:** Execute the two independent code domains in parallel; root owns integration, measurement and review. Steps use checkbox syntax for tracking.

**Goal:** Remove iFlytek read-aloud requests while retaining recognition/scoring and identify where pre-first-text delay occurs.

**Architecture:** Browser/local-only speech queue; backend TTS retirement; numeric-only provider-stream diagnostics.

**Tech Stack:** Existing React/TypeScript/Vitest and FastAPI/httpx/pytest. No new dependencies or paid configuration.

**Spec:** `docs/superpowers/specs/2026-11-01-browser-speech-only-design.md`

## Global Constraints

- Preserve ASR, pronunciation, Interview scores/history, auth and existing whole-reply playback behavior.
- No frontend `/api/tts*` fetch; all three backend TTS endpoints return 410 without opening provider sockets.
- Browser and explicitly selected local mode only; migrate cloud preferences, preserve valid personal settings.
- Missing voices and startup failure are visible failures; no fake success or automatic local downloads.
- Existing main push authorization and commit author EthanLyu30 apply. Preserve primary checkout's nine existing modifications.

## Review Focus

- Persisted preferences of every old version and unknown engine values.
- Voice lists arriving late, disappearing or failing after start; no partial replay.
- Cancellation during discovery and local inference; resource release and truthful telemetry.
- Old clients calling retired endpoints, with no provider dependencies invoked.
- Provider keepalives/role-only frames before content; failures and cancellation retain original semantics.

### Task 1: Frontend read-aloud retirement

- [x] Write/run failing behavior tests for no cloud requests, missing/native-failed voice handling and migration.
- [x] Remove cloud preparation and API helpers, cloud controls and misleading fallback copy; retain native/local behavior.
- [x] Run focused and full frontend tests plus lint/typecheck/build; root commits only this domain after inspection.

### Task 2: Backend retirement and provider diagnostics

- [x] Write/run failing tests proving all TTS routes return 410 with no socket/provider work.
- [x] Retire TTS routes and remove unused lifespan resources; retain ASR/scoring unchanged.
- [x] Write/run failing fake-clock SSE tests for header/first-event/content timings and keepalives, then implement numeric diagnostics.
- [x] Run focused and full backend tests and inspect compatibility of existing traces.

### Task 3: Acceptance and integration

- [x] Measure genuine production model replies and inspect every timing sample; avoid claiming unmeasured capacity limits. Recorded 8 before + 12 after + 3 dispatch samples, all complete; historical 3.18 s not reproduced.
- [x] Independently review combined changes, address material findings, verify native playback/unavailable state and no TTS requests. Review fixes covered; IAB unavailable state works. Edge's native playback fails even in a minimal API control, so audible acceptance remains explicitly open.
- [x] Record results and limitations; verify main identity and nine protected files, integrate/push main and verify deployment/CI. Runtime 3bec465 deployed, CI 499/433 pass; docs-only final integration to follow.
- [ ] Complete residual cleanup after final evidence is recorded. Workspace helpers, logs, DB, previews and caches were verified and removed. System Temp pytest-0/link removal was rejected with only “blocked by policy”; no workaround. Edge control was lost, so four test tabs and localhost-only Aria preference could not be confirmed cleared. See final performance report; preserve all pre-existing/uncertain artifacts.
