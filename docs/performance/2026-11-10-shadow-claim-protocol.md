# Guest claim shadow protocol (0 / 1) — candidate review

Status: Draft PR candidate. Flag `0` is unchanged; flag `1` is a shadow
protocol. This is not a production release decision.

Product commits:

- `8aac01e` backend shadow capability, register decision, late guest writes
- `889a3c7` frontend capability negotiation + claim-confirmed completion
- `a557483` shadow fallback and late-write tests

## Server-side switch

`GUEST_CLAIM_PROTOCOL` is read per request:

| value | capability endpoint | register with `X-Claim-Protocol: 1` | old page (no header) | late anonymous guest write |
|---|---|---|---|---|
| 0 | `{protocol: 0}` | legacy | legacy | legacy |
| 1 | `{protocol: 1}` | atomic account+claim, returns `claim.claimed=true` | legacy, `claim.claimed=false` | accepted into guest space |

The capability endpoint is `GET /api/auth/guest-capabilities`. It is
informational; the register endpoint decides from the flag and the request
header at the time the request arrives.

## Frontend behavior

`getGuestClaimCapability()` uses a 2 s timeout. It returns `1` only for an
explicit `protocol: 1`; 404, timeout, unknown values and protocol `0` all use
legacy. Registration sends `X-Claim-Protocol: 1` only after that check.

The pending-write transition completes with success only when the register
response contains `claim.claimed === true`. A legacy response completes the
transition as failed, preserving queued records. No "已同步" badge exists in
this candidate, so there is no false success label to dismiss.

## Tests and observed evidence

- Backend full: **651 passed**
- Frontend full: **609 passed** (74 files)
- Shadow targeted: **2 passed** (`test_shadow_protocol_allows_late_guest_word_without_claiming_it`, `test_shadow_protocol_keeps_old_page_registration_legacy`)
- Capability fallback: **4 passed** (protocol 1, old-backend 404, timeout, unknown value)
- Frontend ownership targeted: **31 passed**
- Typecheck: pass
- Production build on this Windows host: not rerun after the final shadow edit;
  previous candidate build passed with a workspace `TMP`/`TEMP`. Clean-CI build
  remains required.

Observed backend behavior at flag `1`:

- New header registration returns `claim.claimed=true`; pre-claim word is
  visible to the new account.
- Late anonymous word after claim returns 201 and is **not** visible to the new
  account.
- Old-page registration (no header) returns `claim.claimed=false`; its late
  anonymous word remains guest-visible and is not visible to the account.

This is the intended shadow separation. It does not provide a user-facing
recovery list; that remains a release blocker.

## Version matrix status

| old/new | result | evidence |
|---|---|---|
| old FE + old BE | baseline: late 201 guest, account cannot see | prior review |
| old FE + new BE flag 1 | old page legacy; late 201 guest; account cannot see | backend test `old_page` |
| new FE + old BE | capability 404 -> legacy; no claim confirmation | capability tests |
| new FE + new BE flag 1 | new page atomic claim; late guest remains guest | backend + frontend tests |
| new FE + new BE flag 0 | legacy; `claim.claimed=false`; no success badge | capability/legacy path |
| rollback | no browser-queue rollback run yet | **not verified** |

## Not satisfied / release blockers

1. No user-facing recovery entry for guest records retained after a late write;
   they are currently only visible as guest data, not as a pending card.
2. Real two-tab browser matrix, real PostgreSQL concurrency ordering, and
   registration-response-loss during a queued write were not run in this
   candidate.
3. Capability-query then flag-change race is unit-tested only as a fallback
   function; it was not exercised against a live flag flip.
4. Default clean-CI `npm run build` result is pending; local Windows build path
   is not a clean-CI claim.
5. Flag `1` intentionally accepts late guest writes. It does not merge them into
   the new account; without the recovery UI this is a minimum compatibility
   mode, not a full product acceptance.

No merge or production deployment is requested.
