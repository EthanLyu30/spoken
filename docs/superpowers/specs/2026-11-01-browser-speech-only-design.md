# Browser speech and first-text diagnostics

## User direction

Stop using iFlytek for read-aloud audio. Retain iFlytek transcription and pronunciation scoring, existing Interview grading, learning history and current free hosting. Investigate the wait before the first generated text rather than attributing it to server capacity without evidence.

## Chosen behavior

- Browser Web Speech is the default whole-reply reader in Chrome and Edge. Existing explicit local Kokoro remains optional and falls back only to browser speech. No iFlytek preparation, synthesis or PCM stream request is made by the frontend.
- Missing English voices and native startup failures produce a clear, truthful unavailable/error status. Never silently select cloud audio or claim playback succeeded. Text chat, transcription and scoring remain usable.
- Migrate all previously saved cloud engine preferences to browser speech. Preserve browser voice, speed and pitch; preserve explicitly selected local mode. Remove cloud controls from profile and conversation settings.
- Retire the three public TTS routes with HTTP 410 and no provider dependency or socket creation, including requests from old open tabs. Remove the unused preparation pool and public audio-cache startup ownership. Keep standalone legacy provider protocol utilities/tests where they still serve a verified test purpose; they are unreachable from product APIs.
- Keep existing numeric trace compatibility and historical dashboard records. Add request-to-provider-headers, first nonempty SSE line, headers-to-first-text and pre-text keepalive count. Do not log message bodies, credentials, raw headers or audio. Keep original stream parsing, completion validation, model and token limits.

## Approach and tradeoffs

The user selected cancellation of iFlytek read-aloud. Merely changing the default would leave automatic fallback and old saved settings active, so this change removes the frontend path and retires backend routes. A different cloud speech vendor is outside scope. Missing browser voices therefore result in a visible unavailable state; optional local speech is not downloaded automatically.

First-text delays will be measured on the deployed application with genuine generated replies, collecting every sample, including misses/errors. Client first text, provider first text and full completion remain distinct. The old 3.18-second sample cannot be retroactively decomposed from deleted local intermediate files; reproduce new samples with the new measurements and state that limit.

## Acceptance

Native full-reply playback, stop/cancellation, late voices, unavailable voices and startup failure; no TTS network calls in any read-aloud branch; cloud preference migration; unchanged ASR/scoring routes; 410 routes create no provider connections. Full backend/frontend suites, typecheck/lint/build, independent review and scoped cleanup precede the existing authorized main integration. Browser callbacks do not substitute for human hearing or audio-output observations.
