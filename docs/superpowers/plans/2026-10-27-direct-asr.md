# Direct cloud ASR implementation plan

**Goal:** Preserve complete recordings and reduce production latency by sending PCM directly from the browser to iFlytek, with the current relay as fallback.

**Spec:** `docs/VOICE_RELIABILITY.md`. This is an implementation choice within the requested voice reliability fix; user-visible flows and existing engine choices stay intact.

**Constraints:** Keep the API Secret server-side; never persist or log signed URLs; use 16 kHz mono PCM and bounded waits; preserve local ASR and both relay endpoints; abort must release the active connection. Do not include unrelated deployment edits. Real microphone and human listening checks are deferred at the user's request.

## Task 1: Short-lived connection authorization

- [x] Add failing endpoint tests in `backend/tests/test_asr.py`: configured response, unavailable credentials, no-store caching, no secret serialization, invalid identity.
- [x] Add `POST /api/asr/session` in `backend/app/api/asr.py`, using the existing HMAC signer and identity dependency. Return only the signed URL and public app ID.
- [x] Run the focused backend tests.

## Task 2: Browser transport with complete-turn fallback

- [x] Add `frontend/src/lib/directAsr.test.ts` and routing tests before implementation; cover terminal framing, ordered/corrected transcripts, result-less final, cancellation, network/provider failure, and whole-clip fallback.
- [x] Implement `directAsr.ts`; use a short failure cooldown, memory-only authorization, per-utterance connections and the current 16 kHz PCM format.
- [x] Extract the existing HTTP timeout helper into `requestTimeout.ts` without changing its API, then wire `api.ts` and `asrStream.ts` to prefer direct transport and retain relay fallback.
- [x] Run all frontend/backend tests, lint and build; obtain a focused independent review and fix important findings before pushing.

## Task 3: Production and browser acceptance

- [x] Verify Vercel and Render deployments reference the new code commit.
- [x] Measure real direct streaming and buffered synthetic-audio recognition, and confirm fallback remains usable.
- [x] Complete isolated browser navigation, recommendation/custom scene, conversation, Interview preparation, word review, progress and settings checks. Label synthetic capture accurately.
- [x] Update `design-qa.md`, remove task-specific temporary artifacts, preserve unrelated user files, and push the final record.
