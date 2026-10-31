# Browser compatibility and system reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve cross-browser speech and fix confirmed ownership/session/progress failures before release.

**Architecture:** Harden existing identity helpers and owned-route dependencies; retain existing persistence/account flows. Add independent profile sections and explicit refresh-pending cache flags. Keep browser voice subscriptions alive while settings are mounted.

**Tech Stack:** React18, TypeScript, Zustand, Web Speech, FastAPI, SQLAlchemy.

**Spec:** `docs/superpowers/specs/2026-10-31-edge-system-audit-design.md`.

## Global Constraints

- No new providers, credentials, packages, database migrations or audio slicing.
- Preserve real guest IDs, Bearer ownership, registration without device header, scoring/history, and manual voice preferences.
- Never claim physical Edge/Chrome or model performance from mocked callbacks.
- Preserve nine unrelated dirty files in the primary checkout. Cleanup is limited to proven generated artifacts; policy-rejected deletion remains reported.

## Review Focus

- Storage can permit reads while rejecting token overwrite/removal; UI and requests must still agree on the current account.
- Old ambiguous guest rows must never be exposed or claimed by a new account.
- Background saves and responses arriving after account changes must not restore another owner's data.
- Remounting mid-refresh must retry unfinished sections instead of renewing old data as complete.
- Late Edge Natural voice discovery must update choices without silently replacing the user's explicit selection.

### Task 1: Fail-safe guest and account ownership

**Files:** clientId/authToken helpers and tests; api.ts typed ApiError; auth store/ownership tests; backend deps, auth/asr routes and ownership regression/tests.

- [ ] Write failing tests for unique stable in-memory guests, token write/read/removal failures, 401 vs transient refresh, and blocked missing/blank/anon stored-data access. Preserve headerless registration and optional public endpoints.
- [ ] Implement RAM fallbacks, explicit token overrides, typed HTTP status and 401-only logout; strict data-owner dependency and optional identity where no private records are exposed.
- [ ] Run frontend identity and backend ownership suites, fix compatibility fixtures to identify their test guests explicitly, and commit.

### Task 2: Independent, current progress data

**Files:** progressCache/useProgressData and tests; useProfileData and tests; Profile.tsx/tests.

- [ ] Observe RED for single-endpoint failure, mounted-save invalidation and remounting after partially completed refresh.
- [ ] Track sessionsPending, reset refresh pending flags and resume incomplete cached requests. Load profile sections independently with progress invalidation; voice tab loads stats only. Show partial failures without hiding history; count sessions from authoritative total.
- [ ] Run focused profile/progress tests and commit.

### Task 3: Browser-neutral voice discovery

**Files:** speech.ts, speechWholeReply.test.ts, Profile.tsx.

- [ ] Reproduce late Natural voice discovery and listener cleanup; test Edge's Microsoft Natural selection and full utterance without cloud calls.
- [ ] Keep discovery subscription until cleanup, wire effect disposal, preserve explicit URI and whole-reply playback.
- [ ] Run speech/profile tests and commit. Physical browser acceptance stays explicitly blocked if URL safety detection cannot operate.

### Release

- [ ] Full frontend/backend, lint/type/build, one independent final review and one TDD fix pass for important findings.
- [ ] Verify protected-file hashes, merge/push main as EthanLyu30, check CI/deployment SHA and public non-private API behavior.
- [ ] Report confirmed fixes, deferred date/badge/streak semantics, and exact blocked cleanup artifacts. Keep requested code/spec/plan; delete only permitted owned intermediates after verification.
