# Guest → registered ownership (final review round)

Date: 2026-11-10  
Branch: `review/three-workstreams-20261109`  
Scope: guest practice saved in the same browser, then registration. Local review branch only; no push, merge, or deploy.

## Review findings addressed

The previous round could still lose or misroute a queued write:

- empty `204` delete responses were parsed as JSON, so a successful delete was reported as a failure and its queued replay stayed behind;
- a late `409 guest_data_claimed` after the page switched account was discarded before recovery;
- two guests submitting identical content produced the same recovery record id;
- cross-tab queue writes could overwrite each other;
- a duplicate registration click could discard the first successful registration result.

## Changes

### Empty deletes

`request<T>` and the queued replay path both return without parsing a body when the response is `204`. A queued delete is removed after a successful empty response.

### Late claim rejection

A `409 guest_data_claimed` is retained before the page-generation check. The recovery record keeps the **original guest id** and a stable id derived from guest id, path, and body. The current page may still abort when the account changed; the record remains available for a later authenticated retry.

### Queue atomicity

Queue persistence and removal run through a Web Locks critical section (`spoken-owner-write-queue`) when the browser supports it. The merge step re-reads the persisted array, removes memory-only records already confirmed by another tab/module, and writes only live records. A direct execution fallback remains for browsers without Web Locks.

### Duplicate registration

`register()` calls `beginOwnerTransition()` before advancing the registration operation revision. A duplicate click is rejected by the active transition without invalidating the first request's revision, so the first `201` token and user are still adopted.

## Verification

- `frontend/src/lib/pendingWrites.test.ts` — 20 tests.
- `frontend/src/lib/authSync.test.ts` — 17 tests.
- `frontend/src/lib/api.progress.test.ts` — 6 tests.
- Targeted total: **43 passed** (20 + 17 + 6).
- Full frontend: **73 files / 603 passed**.
- Backend full: **649 passed** (backend unchanged this round; word-definition lock ordering covered).
- TypeScript: pass.
- ESLint: pass.

## Additional hardening

- Sends are serialized by a per-record cross-tab lease; the sender re-reads the queue after taking the lease and skips records another tab already confirmed.
- A 404 on one queued record is caught per record so later saves continue.
- Both 204 paths invalidate progress before returning.
- A late 409 schedules one recovery attempt; auth refresh/login also retries queued records.

## Not accepted yet

- A normal two-tab browser run for simultaneous enqueue, late account switch, duplicate registration, and delete is still required. The queue is unit-tested with Web Locks, but the browser path was not collected in this round.
- Real Postgres concurrency for claim versus old-guest writes was not run; earlier SQLite reproductions are not a substitute.
- Default `npm run build` on this Windows host still fails while deleting an esbuild worker temporary file (`Access is denied`). A workspace `TMP`/`TEMP` build reached the worker stage but failed at the same delete; this is an environment blocker, not a verified clean-CI pass. The source compiled through TypeScript and the earlier large build.
- The browser acceptance evidence from the previous round used a temporary debug hook; that evidence is not reused as proof for this change.

## Commands used

```bash
cd frontend
npm test -- --run src/lib/pendingWrites.test.ts src/lib/authSync.test.ts src/lib/api.progress.test.ts
npm test -- --run
npm run typecheck
npm run lint
```

Backend:

```bash
cd backend
.venv/Scripts/python.exe -m pytest -q
```

## Release status

Hold. This branch is a review candidate only. The 900 ms VAD threshold and 5 s speech watchdog are unchanged by this work.
