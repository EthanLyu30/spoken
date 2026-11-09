# Guest ownership hardening — 2026-11-10

## Scope

Follow-up to the four P1 ownership findings on `2f139e0` / `87659ef` / `d18d15e`.
This is a review-branch change; nothing was pushed, merged, or deployed.

## Fixes

1. **Enqueue identity**
   - A write is queued for a guest→account transition only when no account token is
     present. An existing account (for example account B) keeps its own identity and
     never adopts another tab's registration marker.
2. **Server claim/write boundary**
   - `get_client_id` takes the same `ProgressOwner` lock used by
     `claim_device_data` before checking `GuestClaim`. The claim path re-checks the
     marker after acquiring the same lock. A write that loses the race gets 409
     `guest_data_claimed`; the account-side retry is allowed.
3. **Queue merge and stale markers**
   - Persisted pending writes are merged by record id instead of replacing the
     stored array. A marker older than 60 seconds is discarded before a new
     registration starts.
4. **Single send path**
   - Immediate post-outcome sends and `retryPendingOwnerWrites` share `sendOnce`,
     keyed by record id, so concurrent retries in one page cannot POST the same
     record twice.
5. **Record ownership**
   - Queued records retain the initiating guest id and transition id. A target
     account token is accepted only when its JWT subject equals the transition's
     confirmed target; otherwise the record remains queued for retry.

## Validation

- Targeted: `src/lib/pendingWrites.test.ts` + `src/lib/authSync.test.ts` — 28 passed.
- Full frontend: 73 files / 593 passed.
- Backend: 647 passed.
- TypeScript: pass.
- ESLint: pass.
- Production build:
  - Default `npm run build` still fails locally on the Windows esbuild temp-file
    delete (`[vite:worker-import-meta-url] remove ... Access is denied`).
  - `npm run build` with `TMP`/`TEMP` set to a workspace Windows path passes:
    2254 modules, built in 7.43 s, including `moonshine.worker` and `kokoro.worker`.
  - Clean CI remains the required build proof; local default is an environment
    failure, not a TypeScript/product failure.

## Ownership matrix covered by automated tests

| Scenario | Result |
| --- | --- |
| Guest save in flight before registration | registration waits; save completes; claimed |
| Save starts during registration | queued, not sent as guest |
| Unrelated account B while guest transition is active | not queued under transition; uses B token |
| Save fails with 503 | registration aborts, no token switch |
| Lost registration response | no send as old guest; login/guest-claim retry path |
| Transition outcome unknown | record retained, no guest release |
| Two module instances enqueue | persisted records merge by id |
| Retry and immediate send race | one POST per record in one page |
| Marker older than 60 s | discarded; new registration allowed |

## Not accepted / remaining gaps

- **Two normal browser tabs were not completed in this batch.** The merge and
  stale-marker cases are unit-tested; the required live two-tab, closed-tab,
  refresh, and >15 s acceptance is still pending.
- Cross-tab retry dedupe is not atomic at the database. Stable record ids and the
  session endpoint's `client_session_id` idempotency reduce duplicate rows, but
  this round does not prove every endpoint is idempotent.
- Clean-CI default build and a real Postgres concurrency test are still required
  before merge.

## Verdict

Keep the review branch. The four reported code paths have targeted fixes and
regression tests, but the required normal-browser two-tab acceptance and clean-CI
build have not passed, so this is not a merge or production recommendation.
