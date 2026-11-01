# Reliability and performance implementation plan

> **For agentic workers:** Follow TDD for each independently testable domain. Root coordinates integration and one fresh whole-branch review; independent frontend/backend work may run in parallel with the contracts below. Steps use checkboxes.

**Goal:** Fix acknowledged data reliability issues before reducing asset, statistics and pronunciation latency, then verify and push main.
**Architecture:** Optional owner-scoped idempotency, mutation ordering, hashed responsive assets, SQL aggregation and bounded live pronunciation transport.
**Tech Stack:** Existing React/TypeScript/Vitest, FastAPI/SQLAlchemy/pytest, existing image encoder.
**Spec:** `docs/superpowers/specs/2026-11-01-reliability-performance-design.md`

## Global constraints

- No paid upgrades; no unrelated features or redesign.
- Old practice/review clients remain accepted; new optional field is `client_request_id`, maximum 80 characters.
- Existing API optional signal positions remain unchanged. Save/review IDs are supplied after the signal.
- Preserve score scales, video/DeepSeek results, owner isolation, local days, permanent badges, guest claim and legacy records.
- Preserve original PNG inputs and the primary checkout's nine user changes. No force push or worktree deletion.

## Review focus

- Refresh resolving between server commit and POST response; remove then re-add during the same creation.
- Lost save/review response, repeated retries, conflicting reused keys, and owner claim/pruned source history.
- Reversed responses/rollbacks and navigation/account change while operations are pending.
- Timezone boundaries, DST and half/quarter-hour zones with old and new learning receipts.
- Browser sample-rate mismatch, streaming startup failure, disconnect, final-result silence and cleanup.

### Task 1: Persistence and frontend reliability

**Backend files:** models/schemas/services for practice/words; DB additive migration and owner claim; relevant tests.
**Frontend files:** store/words.ts, WordBag.tsx, useInterviewSession.ts, PronounceButton.tsx, Progress.tsx, api.ts and related tests.
**Produces:** Optional owner-scoped `client_request_id`; stable retry IDs; review promise/error handling and ordered writes.

- [ ] Write failing backend replay/conflict/legacy/prune/claim tests; implement transactional practice/review receipts and additive migration; run focused and full backend tests.
- [ ] Write failing frontend collection/refresh/remove-readd, master ordering, failed review/save and detail-selection tests.
- [ ] Implement explicit intents, serialized/revision-guarded writes, stable retry IDs and visible save failures; run focused and full frontend checks.
- [ ] Inspect combined contract and commit only verified reliability changes as EthanLyu30.

### Task 2: Images, cache and statistics

**Files:** image variants/imports, ui.css, Wordmark/Buddy, vercel.json; services/progress.py and aggregation tests.
**Consumes:** Task 1 receipts/claim semantics; do not alter their credit meaning.

- [ ] Record original image bytes and stats benchmark; retain source PNGs.
- [ ] Add same-content optimized WebP sizes and build-hashed imports; immutable cache only for assets; verify image quality/bytes and production build references.
- [ ] Write failing bounded-result aggregation and timezone/semantics parity tests, implement SQL aggregates; retain supplied-event behavior and owner locks.
- [ ] Run statistics regressions, compare identical 1k/10k/50k data, run full checks and commit.

### Task 3: Pronunciation waiting

**Files:** xf_ise.py, pronunciation API and stream schema; recorder/audio transport, PronounceButton and tests.
**Consumes:** Task 1 stable practice saving; provider evaluation remains iFlytek and public buffered compatibility remains.

- [ ] Write failing deadline, concurrent receive and streaming transport tests with fake sockets/time.
- [ ] Implement bounded provider session/upload/result lifecycle and streaming route; retain provider pacing.
- [ ] Write failing capture equivalence, stream/fallback/cancel/owner-change UI tests; implement recording-time transmission and preserve usable buffered compatibility.
- [ ] Measure deterministic upload overlap and final wait against baseline; run full suites/lint/typecheck/build and commit.

### Task 4: Review, deployment and cleanup

- [ ] Fresh-context whole-branch review; fix material findings with observed regressions and green checks.
- [ ] Exercise reachable main flows, payload compatibility and build assets; report physical browser/mic limits honestly if tooling remains blocked.
- [ ] Record actual timing/bytes before and after; verify protected hashes, fast-forward main and push; verify CI and deployment.
- [ ] Stop task-owned services and remove only verified task scratch/caches/previews after final report is verified; explicitly report any blocked residue.
