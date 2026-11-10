# Guest claim rollout verification

Draft PR #94 is based on production commit 42f10ba. The candidate product
commit is 7538246. Tests used synthetic accounts and isolated databases.

## Behavior

- GUEST_CLAIM_PROTOCOL accepts modes 0 and 1. The capability lookup has a
  two-second deadline. The registration endpoint makes the final decision
  using its current mode and the request header.
- A normal registration moves committed guest sessions, practice and words
  in the same transaction as account creation. An upgraded client uses the
  explicit response to release writes queued for that registration.
- A legacy browser can still save to the guest namespace after a claim or a
  switch back to mode 0. A later legacy registration can create an account
  without acquiring records from an already-claimed guest namespace.
- A late write from an upgraded browser only queues for account replay if
  that browser observed a matching claim complete after dispatch. Other
  claim conflicts can retry once under the original anonymous identity.
- Open 「学习进度」 and select 「查看本浏览器的游客记录」 to inspect retained
  guest data. The panel makes read-only guest requests on demand. Guest
  records remain separate from account statistics and history.

## Browser matrix

Edge 157.0.4341.42 loaded production builds of both frontends in independent
two-tab contexts. Each row used UI registration and logout. The second tab
seeded one session, practice and word through the real API, and held a
legacy anonymous word request before network dispatch until registration
completed. All registrations and word saves returned 201.

| Frontend | Backend | Account session / practice / word IDs | Late guest word ID | Word saved as guest after logout | Candidate page can find late word |
| --- | --- | --- | --- | --- | --- |
| 42f10ba | 42f10ba | 1 / 1 / 1 | 2 | 3, same guest | Baseline uses the old page |
| 42f10ba | 7538246 mode 1 | 1 / 1 / 1 | 2 | 3, same guest | Yes, after loading the candidate |
| 7538246 | 42f10ba | 2 / 2 / 4 | 5 | 6, new guest | Yes, in previous guest records |
| 7538246 | 7538246 mode 1 | 2 / 2 / 4 | 5 | 6, new guest | Yes, in previous guest records |

Each row made one registration request and one delayed word request.
Post-logout saves remained invisible to the original account.

## Browser rollback

The server committed a mode 1 registration, but the browser lost its
response. The other tab queued one word through the vocabulary page.
While registration was pending the submit button stayed disabled, and a
second click left the request count at one. The backend then switched to
mode 0 and the browser loaded the original frontend. A successful login
left one record in the browser queue and zero in the account.

Loading the candidate frontend again reduced the queue to zero and made
word ID 1 visible only in the account. The vocabulary page sent one DELETE
and received 204. The account had zero words after deletion.

## Browser account switch

The second tab started a protocol-aware word save before account A
registered. The browser then logged out of A and logged into B before the
held request reached the server. The original request returned 409 and
left one local queued record. Account B had zero words from the request.
Logging back into A sent one successful replay and cleared the queue.
Only account A could read word ID 1. The original guest scope was empty.

## PostgreSQL 16.15

Two independent request workers used a local PostgreSQL instance. A
before-commit barrier held the first transaction while the second requested
the same guest owner lock. PostgreSQL reported a transactionid lock wait in
all three orders. Each test reconciled the final business record IDs by
reading both the account and guest scopes.

| First commit | Other request | Result | Final account IDs | Final guest IDs |
| --- | --- | --- | --- | --- |
| Guest word save | Claim | Save and registration 201 | 1 | Empty |
| Claim | Legacy guest word save | Save and registration 201 | Empty | 2 |
| Claim | Upgraded guest word save | Save 409, two authenticated attempts returned the same ID | 3 | Empty |

## Verification commands

From the backend run pytest -q. From the frontend run npm test,
npm run typecheck, npm run lint and npm run build. The local suite returned
654 backend passes and 613 frontend passes across 75 files. The normal
minified build completed with a temporary output directory.

[GitHub Actions for the candidate](https://github.com/EthanLyu30/spoken/actions/runs/42830060996)

## Deployment boundary

Deploy the compatible backend in mode 0 and confirm the capability before
enabling mode 1. Use mode 0 on that same backend for rollback. Keep the
claim table and claim-status route so existing queued records can resolve
after the frontend is restored. The original backend binary does not
recognize a reserved guest namespace and must not be the rollback target
after mode 1 creates claims.

An old backend has no claim receipt for a registration response the client
never received. This path preserves the local queue without assuming an
account owner. The mode 1 recovery guarantee applies to registrations that
recorded a server claim.
