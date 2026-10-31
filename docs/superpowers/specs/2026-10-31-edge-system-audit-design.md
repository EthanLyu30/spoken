# Browser compatibility and system reliability repair

User intent: Edge and Chrome must both use browser whole-reply speech; remove unused generated caches, and find/fix reproducible reliability problems throughout existing functionality.

Confirmed findings: failed localStorage can put unrelated guests in the same `anon` scope; token writes/removals can leave requests using a different identity than the UI; any refresh network failure logs out the account; Profile couples independent endpoints and misses save invalidations; progress refresh can cache old data as freshly complete; voice discovery stops listening before later voices appear.

Keep current React/FastAPI stack, database, browser default and complete audio. Use random in-memory guest identity and token fallbacks; reject ambiguous ownership on stored-data endpoints while preserving headerless registration and public ASR. Only 401 invalidates a session. Keep profile/progress sections independent and track incomplete refreshes. Subscribe to browser voice changes until unmount, including Edge Natural voices. No browser-name gating, new supplier, package or credentials.

Acceptance: regression-first tests for storage failures/cross-owner access/transient errors/quick-navigation refresh/late voice arrival; full frontend/backend and lint/type/build; independent final review; main push as EthanLyu30 and production checks. Browser tools have stopped because they cannot determine Edge's URL; do not equate mocked compatibility with physical playback/hearing. Cleanup attempts for the old task directory and pytest cache were policy-rejected; no alternate deletion mechanism may bypass that decision.

Deferred investigation: lifetime badge aggregation, user-timezone daily boundaries and vocabulary-review streak semantics require a separate consistent data contract. They are not silently marked fixed here. Failed token deletion cannot guarantee logout survives a later reload with readable stale storage; the current page must still immediately stop sending the token.
