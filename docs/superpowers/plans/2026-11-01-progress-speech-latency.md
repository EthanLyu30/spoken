# Progress and Speech Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure and reduce progress/whole-reply speech latency without paid infrastructure or functional regressions.

**Architecture:** Fixed numeric tracing identifies DB/network/provider stages. Narrow SQL/projection changes and a thin session overview remove unnecessary work; a generation-safe shared metadata resource removes duplicate reads. Lifespan HTTP pooling, early voice discovery and public-only complete-WAV reuse reduce eligible speech delays.

**Tech Stack:** Python3.11/FastAPI/SQLAlchemy/HTTPX, React/TypeScript/Vitest.

**Spec:** docs/superpowers/specs/2026-11-01-progress-speech-latency-design.md

## Global Constraints

- Existing free hosting/providers/model; browser default; one whole utterance or WAV, never sentence/chunk stitching.
- Preserve independent partial progress, freshness/ownership/ABA, SRS, permanent achievements/receipts and interview5/legacy6 history.
- Only numeric/fixed-label diagnostics; no SQL content, parameters, text, answers, keys, signed URLs, identity or raw exception strings in metrics.
- Commits exactly EthanLyu30 <2454472858@qq.com>; protect nine dirty D: files; no force push or published-history rewrite.
- Root owns docs, baseline/after measurements and release; implementers do not spawn, push/merge, delete, access .env/realDB or make provider calls.

## Review Focus

- Cold/empty/populated paths, SQLite/Postgres locking and atomic awards must keep the same data semantics while reducing round trips.
- Stats/practice failure must not hide available history; overview data must never be presented as fabricated full history detail.
- Dedup cancellation, auth ABA, mutation/manual reload and midnight/timezone races must reject old work and preserve other subscribers.
- Shared async clients must close exactly once per lifespan without cancelling siblings or surviving into another event loop.
- Cold synthesis/private text must not be mislabeled as a cache improvement; late Natural voices and real playback semantics must remain intact.

### Task 1: Content-free stage measurements and baseline

**Files:** backend/app/core/observability.py, new core/performance.py if useful; db/service acquisition/commit boundaries in services/{practice,sessions}.py; services/{deepseek,xf_tts}.py; main.py CORS exposure if needed; relevant monitoring sanitizer/tests. No optimization or frontend edits in this task.

- [ ] Add failing regressions for request-isolated numeric DB acquisition/query count/duration, commit/CPU timing, safe fixed-name Server-Timing, upstream TCP/TLS/header and TTS connect/first/complete/close metrics. Ensure disabled tracing/errors/cancellation/streaming do not change behavior or leak private values.
- [ ] Instrument actual service work, not eager get_db acquisition before auth validation. Keep SQL event installation idempotent, errors balanced and trace context safe across FastAPI worker threads. Acquisition includes setup/pre-ping; do not mislabel it as SQL duration. Current streaming response starts before provider completion, so final measurements remain trace data rather than false early headers.
- [ ] Keep request/model/audio payloads, client lifetime and SQL logic unchanged. Add/extend only fixed numeric attribute allowlists. Tests must confirm secret/content sentinel values absent from headers/records. Use existing backend test interpreter D:/personal_space/spoken/backend/.venv/Scripts/python.exe.
- [ ] Run focused and full backend tests once at completion, self-review and report exact red/green evidence. Commit only assigned backend paths. Report .superpowers/sdd/2026-11-01-progress-speech-latency/task-1-report.md. Root will review and publish the verified measurement-only baseline, collect comparable measurements, then release dependent server optimizations.

### Task 2: Reduce progress database work and expose thin session overview

**Files:** backend services/{progress,practice,sessions}.py, api/{practice,sessions}.py or focused progress router; schemas/{practice,session}.py; new focused performance regression tests. Start after Task1 stage boundaries are stable; backend only.

- [ ] TDD portable combined event-existence/badge/count snapshot and one-statement owner locking. Assert stats6→4 repeated populated and3→1 empty SQL (new awards may add1). Empty snapshots can be reused without owner writes; populated snapshots must discard speculative badge/count values and re-read them after the lock. Preserve concurrent awards/claim order/rollback/permanent receipts/timezones and independent callers. Update diagnostic baseline count expectations only for the actual optimized path.
- [ ] Add GET /api/progress/sessions returning {sessions,insights,latest}, where latest is null or {id,scores} only. Project50 session metadata rows and score rows for the newest8 in at most2 SQL; derive the SAME insight algorithm and latest radar from those scores. No transcript/summary/tip selection. Use owner filters on score joins and preserve existing list/detail/insight APIs. Reuse the algorithm rather than duplicate it.
- [ ] Minimize unused history data safely. Current interview score_max requires valid detail score_max5 AND scoring_version=ets-interview-text-v1; preserve malformed/missing/unknown6 and pronunciation100. A conditional detail projection may exclude pronunciation bodies; do not silently change old history or add a broad migration just for this patch.
- [ ] Run synthetic empty/12-session/retention-scale query/projection equivalence tests and existing progress/ownership/migration/history suites; full backend once after final code. Report exact SQL/checkouts/selected bytes and limitations. Commit explicit paths, report task-2-report.md. Coordinate the stable overview schema with Task3 early.

### Task 3: Share metadata reads and integrate thin progress sessions

**Files:** frontend/src/lib/api.ts, new lib/readResource.ts with tests; hooks/{useProgressData,useProfileData}.ts, lib/progressCache.ts; Progress.tsx type use and relevant stats consumers/tests as needed. Own api.ts; Task4 owns speech/voice/telemetry files.

- [ ] TDD shared stats/session/practice metadata reads: one transport for concurrent consumers, independent abort, last-reader abandonment, stale finalizer vs successor, owner/auth/progress/day/URL/limit key separation, bounded30s freshness/max32 entries, mutation invalidation, interrupted forced reload and midnight races. No raw tokens in keys; no general report/answer caching.
- [ ] Add getProgressSessions(signal) for Task2's GET /api/progress/sessions schema {sessions,insights,latest:null|{id,scores}}. Progress loads it, stats and practice independently: target3 requests instead of4+dependent detail, preserving readable sections while stats or practice stall. Retain manual retry/partial errors and correct radar/trend results. Do not fabricate SessionDetail messages/summary/tip.
- [ ] Share completed metadata and flights across Home/Profile/Progress within the30s policy. Auth/mutation generation changes clear/obsolete old data; forced reload bypasses completed freshness. Avoid duplicate manual-refresh effects and timer storms. Existing API ownership checks before header dispatch and after responses remain intact.
- [ ] Run focused cache/API/progress/profile tests while iterating, full frontend once when coordinated source is coherent, then lint/typecheck/build. Do not edit Task4 speech/voice/telemetry files. Commit only assigned paths, report task-3-report.md with exact evidence and response/request counts.

### Task 4: Whole-reply voice preparation and upstream reuse

**Files:** backend/main.py, api/chat.py shared dependency, services/deepseek.py, focused public_tts_cache service and api/tts.py; frontend/lib/{speech,voiceResolver,telemetry}.ts and telemetry schema/labels as needed; focused pooling/cache/speech tests. Start after Task1 baseline instrumentation; don't edit api.ts or progress files without root coordination.

- [ ] TDD lifespan HTTPX client injection:20 total/10 idle/60s expiry, trust_envFalse and existing60/10 deadlines; standalone fallback. Complete/stream reuse, response closure on cancellation, sibling isolation, startup-failure/shutdown close-once and no cross-loop global client. Preserve all models/prompts/usage/grade budgets.
- [ ] TDD early browser-voice discovery concurrent with text generation, without speaking until final text; late English/Natural voice must override an early empty result; stop cleans listeners. Keep existing deadlines and local-first/fallback behavior. Add separate final-text-to-first-audio, voice-resolution/native-start/cloud-fetch/play-start timings using existing interaction association; retain old metric definitions and accept the new fixed operation names in telemetry/labels.
- [ ] TDD public-text-only complete-WAV cache for exact built-in openings and fixed preview:16 entries/4MiB/300s maximum; key all effective voice/prosody/format/version fields; only complete success, never custom/private/generated/interview/dictionary text or object URLs. Cold miss remains whole synthesis. No speculative synthesis, provider/model changes or streaming/chunk playback.
- [ ] Run targeted lifecycle/cancellation/whole-reply/voice discovery/cache/telemetry tests, then full affected suites once after coherent code; self-review and commit explicit assigned paths. Report task-4-report.md, including cache cold/hit distinctions and any stage not measurable without hardware.

### Task 5: Matched comparison, final verification, cleanup and main release

Root orchestration and release.

- [ ] Record before/after individual samples with same URLs, empty scope/timezone, public prompt/history and voice/speed/pitch; median/range/sample count, first text/full text/full WAV, cold/reused requests and public-WAV cache hits separately. No production account/practice writes. Use synthetic populated fixtures locally for SQL/checkouts/bytes/partial timing; do not present simulations as live user timings.
- [ ] Review each task then one whole branch; fix important findings in one combined final wave and one scoped re-review. Protect source3.11, scoring/history, no-cut speech and ownership. No fake microphone/listening/browser evidence when tools fail.
- [ ] Run appropriate final gates and primary-checkout integration checks, verify protected9 hashes, merge/push main after authorization already given, verify CI/Render/Vercel and exact frontend release/new endpoint headers. No paid plan/config changes.
- [ ] Retain only final source/spec/plan/comparison report; clean verified task builds/caches/fixtures/helper/review workspace using bounded native PowerShell without -Force after verification. Preserve user inputs/dependencies/env/data/uncertain files. Record actual gains and residual waits, including unsuccessful samples, in final handoff.
