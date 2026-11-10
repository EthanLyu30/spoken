# Guest → registered ownership transition (second review)

Date: 2026-11-09
Branch: `review/three-workstreams-20261109`
Scope: guest practice saved in the same browser, then registration. No production deploy.

## Review findings fixed

The previous 50 ms flush only waited for requests that had already been sent. It did not cover
a save that started after registration began, a cross-tab save, a lost registration response,
or a failed save. The new design binds a queued write to the guest identity that created it and
to one registration transaction.

## Backend

- `GuestClaim` records the first owner of a guest client id. The claim row is written in the same
  transaction as the owner-id rewrite, so a later old-guest write can be identified.
- `GET /api/auth/guest-claim?guest_id=...` returns `{claimed, mine}` only for the authenticated
  account; it never exposes the owner id.
- A late guest-scoped write for a claimed guest is rejected with `409 guest_data_claimed` unless
  the bearer account is the recorded owner. The target account may retry with the original guest
  id; the same record id is still deduplicated by the request-receipt path.
- Normal guest practice and logout→guest are preserved.

## Frontend

- `beginOwnerTransition()` records the initiating guest id and a unique transition id. The marker
  is persisted so another tab can see it.
- Owner-scoped writes that start while a transition is active are not sent. They are persisted in
  `spoken-owner-pending-writes` with their guest id, transition id and body.
- `completeOwnerTransition("success", userId)` releases only that transaction. A queued write is
  sent only if the current token subject equals `userId`; failed/unknown outcomes keep the record
  for retry. A 60 s external-tab wait becomes `unknown`, never an implicit guest release.
- `register()` flushes writes that started before it, then begins the transition. A failed flush
  aborts registration; `completeOwnerTransition` runs on success/failure and never releases to the
  old guest.
- `retryPendingOwnerWrites()` verifies `/api/auth/guest-claim` before retrying a record whose
  outcome is unknown (lost registration response).
- Logout rotates the guest client id, so the browser can be used as a new guest after a claim.

## Browser acceptance (normal Chrome, local stack)

Environment: Chrome 156, normal CORS (no `--disable-web-security`), local FastAPI `:8011`,
Vite `:5173`, one fresh profile per scenario.

| Scenario | Result |
| --- | --- |
| save starts after registration POST | registration 1400 ms delayed; late save completed; new account sessions `[late, seed]`; old guest `[]`; PASS |
| `/api/sessions` returns 503 | save error surfaced; `POST /api/auth/register` count 0; no token; transition cleared; PASS |
| registration response lost after server completed | registration client error; queued save remained; login recovered account; `retryPendingOwnerWrites()` sent 1; new account saw `[late, seed]`; PASS |

These runs used a temporary same-module debug hook to start the save at a controlled point; the
hooks were removed before commit. The hook does not change the production branch.

## Tests

- `frontend/src/lib/pendingWrites.test.ts` — 8 tests: in-flight save, failed save retained for a
  later flush, late save queues until outcome, cross-tab marker, unrelated account token, unknown
  outcome, second transition rejected.
- `frontend/src/lib/authSync.test.ts` — 16 tests: registration starts/ends transition, aborts on
  flush failure, clears transition in both paths.
- `backend/tests/test_auth.py` — claim row, second-account claim rejection, old-guest late write
  409, target-account retry 201, `guest-claim` mine/not-mine.
- Full frontend: 73 files / 589 passed before the retained-failure test; targeted 24 passed.
- Full backend: 647 passed.
- TypeScript and ESLint pass.

## Remaining gaps

- Two-tab browser run is not accepted yet: a page that saved after the other tab had already
  completed registration was still processed after the token was visible. Cross-tab gate is
  covered by unit test but not by a normal two-tab browser pass.
- Repeated-click registration and a >15 s cross-tab wait were not collected.
- Real production cannot be used for these fault injections; acceptance is local.
- Production build: default minified `npm run build` still fails on this Windows host deleting an
  esbuild worker temp file (`Access is denied`). `npx vite build --minify=false` completed all 2254
  modules and emitted the production bundle, so the source/compile path is verified; the default
  minified build remains an environment-only blocker.
