# Browser-local speech models implementation plan

> **Execution note:** Apply this plan task-by-task with red/green tests and verify the production deployment after merging to `main`.

**Goal:** Reduce iFlytek ASR/TTS usage and improve fallback speech quality by preloading Moonshine ASR and Kokoro TTS asynchronously in capable browsers, while preserving existing browser-voice and iFlytek fallbacks.

**Architecture:** Keep the existing microphone, VAD, and sentence queue. Run model loading and inference in dedicated Web Workers so downloads and CPU work do not block React. A small coordinator serializes background downloads (Moonshine first, Kokoro only when an English browser voice is unavailable), respects data-saver/low-memory signals, and relies on Transformers.js/Cache Storage browser caching. Engine selection is made at utterance or sentence boundaries; an already-started cloud operation is never switched mid-flight.

**Libraries:** React 18, TypeScript, Vite workers, `@huggingface/transformers@3.8.1`, `kokoro-js@1.2.1`, Vitest.

---

## Task 1: Model scheduling and capability policy

**Files:**

- Add `frontend/src/lib/localSpeech/policy.ts`
- Add `frontend/src/lib/localSpeech/policy.test.ts`
- Add `frontend/src/lib/localSpeech/coordinator.ts`
- Add `frontend/src/lib/localSpeech/coordinator.test.ts`

**Steps:**

1. Write failing tests for data-saver, low-memory, unsupported Worker/Cache APIs, idle scheduling, and serialized Moonshine-before-Kokoro loading.
2. Implement pure capability checks with conservative fallbacks when browser hints are unavailable.
3. Implement a coordinator with observable `idle | loading | ready | unavailable | error` state per model and one shared loading chain.
4. Verify targeted tests pass.

## Task 2: Moonshine ASR worker and cloud fallback

**Files:**

- Add `frontend/src/lib/localSpeech/protocol.ts`
- Add `frontend/src/lib/localSpeech/workerClient.ts`
- Add `frontend/src/lib/localSpeech/moonshine.ts`
- Add `frontend/src/lib/localSpeech/moonshine.worker.ts`
- Add `frontend/src/lib/transcribe.ts`
- Add `frontend/src/lib/transcribe.test.ts`
- Modify `frontend/src/lib/call.ts`
- Modify `frontend/src/pages/Conversation.tsx`
- Modify `frontend/src/pages/Interview.tsx`

**Steps:**

1. Add tests proving ready Moonshine receives normalized 16 kHz samples and cloud ASR remains the fallback for loading/error states.
2. Add a request/response Worker client with load progress, transferable audio buffers, timeouts, and failure isolation.
3. In the worker, enable browser caching and load `onnx-community/moonshine-tiny-ONNX` as an automatic-speech-recognition pipeline using WASM with quantized decoder weights.
4. Route push-to-talk and interview recordings through the unified transcriber.
5. In call mode, choose local versus iFlytek at each utterance start. Keep iFlytek live captions only for cloud-selected utterances; use the already-buffered PCM for local final transcription.
6. Verify ASR unit tests and existing call behavior.

## Task 3: Kokoro TTS worker and sentence-boundary fallback

**Files:**

- Add `frontend/src/lib/localSpeech/kokoro.ts`
- Add `frontend/src/lib/localSpeech/kokoro.worker.ts`
- Add `frontend/src/lib/localSpeech/audio.ts`
- Add `frontend/src/lib/localSpeech/audio.test.ts`
- Modify `frontend/src/lib/speech.ts`
- Modify `frontend/src/lib/speech.test.ts`

**Steps:**

1. Add tests for PCM-to-WAV encoding, Kokoro selection when ready, and iFlytek fallback when Kokoro is unavailable or synthesis fails.
2. Load `onnx-community/Kokoro-82M-v1.0-ONNX` in a separate Worker: prefer q4f16 WebGPU when `shader-f16` is available, otherwise q8 WASM, using the `af_heart` voice.
3. Transfer generated 24 kHz Float32 PCM to the main thread and play it through a short-lived object URL.
4. Warm the model and run a second steady-state probe. Mark Kokoro unavailable when its real-time factor exceeds 1.25 so free local synthesis cannot make conversation materially slower.
5. Resolve each queued sentence independently: explicit iFlytek remains explicit; automatic browser fallback uses Kokoro when ready and otherwise iFlytek. This allows the next sentence to switch after model readiness without interrupting current playback.
6. Preserve cancellation and object-URL cleanup.

## Task 4: App-level asynchronous preload

**Files:**

- Modify `frontend/src/main.tsx`
- Add `frontend/src/lib/localSpeech/bootstrap.ts`
- Add `frontend/src/lib/localSpeech/bootstrap.test.ts`

**Steps:**

1. Write tests for post-mount idle preload, Moonshine-first ordering, Kokoro suppression when an English browser voice exists, and StrictMode idempotence.
2. Start preload after first paint/idle without awaiting it.
3. Re-check browser voices after their asynchronous discovery window before deciding whether Kokoro is needed.
4. Keep all failures silent and non-blocking because iFlytek remains operational.

## Task 5: Dependency, bundle, and production verification

**Files:**

- Modify `frontend/package.json`
- Modify `frontend/package-lock.json`
- Update relevant architecture/deployment notes if needed

**Steps:**

1. Install pinned compatible browser inference dependencies.
2. Run focused tests after each task, then full frontend tests, typecheck/build/lint, and backend tests.
3. Inspect Vite output to confirm model workers are separate lazy assets and the main bundle has not absorbed model runtimes.
4. Smoke-test local browser behavior with and without Web Speech voices and confirm network/model failures still reach iFlytek.
5. Commit the feature branch, merge it into local `main`, rerun verification, push `main`, and monitor GitHub checks plus Render/Vercel/public health endpoints until the deployment is live.
