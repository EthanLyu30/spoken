# Guest write ownership during registration

Date: 2026-11-09
Branch: `review/three-workstreams-20261109`
Base: `42f10ba9532d259d8231b9b9c29ec0a867251780`

## Problem

Registration waited only for owner writes that had already started. A summary
save, or a save in another tab, could therefore start after registration's
claim and land under the old guest id. A failed save was also only "waited
for"; registration could still switch accounts, and the tracking promise could
surface an unhandled rejection.

## Fix

- `frontend/src/lib/api.ts`
  - Owner writes are gated by a registration transition marker
    (`spoken-owner-transition`). A write starting in the registration tab, or
    in another tab that can see the marker, waits for the token decision.
  - `pendingWrites` now keeps a settlement result; `flushPendingWrites()`
    waits for the tracked request and throws its error, instead of relying on a
    50 ms grace period.
  - Tracked promises are settled by the request wrapper, so a caught request
    failure does not become an unhandled rejection.
- `frontend/src/store/auth.ts`
  - `register()` calls `beginOwnerTransition()` before flushing, and
    `endOwnerTransition()` in `finally`.
  - A failed pending save now aborts registration; no token/account switch.
- `frontend/src/lib/pendingWrites.test.ts`
  - in-flight save blocks flush;
  - failed save makes flush reject;
  - save starting after transition begins is queued;
  - a transition marker from another tab queues the save until storage changes.
- `frontend/src/lib/authSync.test.ts`
  - registration does not call `registerUser` or set a token when the pending
    save fails, and always releases the transition.

## Normal browser checks

Environment: Chrome 156, `http://127.0.0.1:5173` (normal page, no
`--disable-web-security`, no CORS override), API `http://127.0.0.1:8011`,
temporary debug hooks used by the harness and removed before commit. Chrome was
launched with `--no-sandbox` because this Windows test host otherwise exits the
remote-debugging process.

### Late save after the registration POST

The register response was delayed after the request reached the server. The
save was started after the POST was observed:

```text
register POST observed  3061.3ms
save started            3066.5ms
save finished           4478.2ms
late session id         2
new account sessions    [2, 1]
old guest sessions      []
```

Pass: the late save is under the new account, not the old guest; the old guest
cannot read it.

### Save returns 503

```text
save requests           1
register requests       0
register error          ApiError: save unavailable
token after attempt     null
transition marker       null
unhandled rejections    []
```

Pass: registration aborts before the account switch.

### Registration response lost

The server received and completed registration, then the response was dropped
in the browser. Login with the same credentials recovered the account:

```text
register error          TypeError: network lost after request
token after register    null
login error             null
seed visible            true
old guest sessions      []
```

This is the expected recoverable state: the account exists and contains the
claimed guest data; the user can log in rather than retrying registration and
receiving "email already registered" with no data.

## Not accepted yet

- Two-tab browser run did **not** exercise the gate: registration completed
  before the second tab's save started (page 2 observed the token already
  present). The cross-tab gate is covered by unit test only.
- Repeated registration clicks, real network loss, and a shared-browser
  second guest after logout are not browser-accepted here.
- A direct backend guest write after claim still returns 201; the fix prevents
  the application from issuing that write, but does not add a server-side
  rejection/redirect for arbitrary clients.

## Tests

```text
frontend targeted: pendingWrites + authSync = 20 passed
frontend full:     73 files / 585 passed
typecheck:         pass
lint:              pass
production build:  pass, built in 9.46s
backend:           unchanged; 644 passed before this frontend-only change
```
