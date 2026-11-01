# Reliability and performance implementation

The user explicitly authorized the audit's implementation order: fix collection deletion, failed saves, duplicate Interview credit and stale responses, then images/cache, statistics and pronunciation waiting; verify, clean task artifacts and push main without paid upgrades.

## Engineering choices

Use the existing React/FastAPI/SQLAlchemy stack and existing linked worktree. Add optional `client_request_id` (1–80 characters) to practice creation and word-review bodies. Old callers remain valid. New callers keep one identifier per logical save/review and reuse it on retries. Dedupe is owner-scoped and transactional; a reused identifier with conflicting input must fail, and response loss, source-history pruning and guest claiming must not award credit twice. Minimal durable receipts are acceptable; do not duplicate answer bodies permanently.

The frontend API extends existing signatures without breaking callers:
`savePractice(kind, score, title, detail, signal?, clientRequestId?)` and
`reviewWord(id, remembered, signal?, clientRequestId?)`.

Use explicit collection/removal intent and per-item serialization/revisions. Await successful review persistence before advancing cards; omit unsaved negative IDs. Failed practice saves preserve the score and a stable retry operation. Guard all history-detail completions, including finally, against stale requests and owner changes.

For statistics, retain the permanent journal and badge semantics, but move aggregation into bounded-result SQL instead of loading every event object. Preserve local-date conversion, DST/fractional offsets, current/longest streak, permanent unique collection/review credit, legacy migration and guest claims. Preserve supplied-event compatibility where existing callers need it. Measure with the same 1k/10k/50k synthetic data; no unmeasured production speed claim.

Keep original image inputs. Produce optimized responsive WebP variants and a small logo, preserve visual content, and use build-hashed asset URLs. Cache only `/assets/` immutably; HTML remains revalidated, private APIs remain uncached by this rule.

For pronunciation, preserve iFlytek recognition/scoring and the buffered endpoint. Add a bounded streaming path to overlap recorded audio transmission with recording, concurrently receive results and enforce overall/final deadlines. Retain the provider's recommended pacing. Reuse the existing capture/resampling infrastructure and retain final PCM for compatibility. Failures/cancellation must release mic/context/socket; fallback must be bounded and truthful. This does not restore retired iFlytek read-aloud.

## Verification and scope

Use observed RED→GREEN regression tests for data-loss ordering, explicit remove/re-add, reverse mastery responses, review/save failures and lost-response retries. Test legacy callers, changed owners, pruned histories and duplicate guest claims. Verify streamed and buffered PCM equivalence at real device sample rates, empty audio, provider errors, cancellation and final-result timeouts. Full existing backend/frontend suites plus lint/typecheck/build must pass, followed by independent whole-branch review and deployed endpoint/assets checks.

Do not include unrelated quota/dependency redesigns from the broader audit. Existing admin permissions, retired TTS routes, Interview 0–5 grading/video references/upgraded samples, local-time daily counts and permanent achievements remain compatible. Primary checkout's nine existing user modifications remain byte-identical. Commit as EthanLyu30 and use the already authorized main push. Keep host-managed worktree; remove only verified artifacts made for this plan.
