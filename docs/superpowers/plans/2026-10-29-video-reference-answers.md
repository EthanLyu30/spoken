# Video Reference Answers Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for each owned task; data collection, backend and frontend have disjoint outputs and may proceed in parallel.

**Goal:** DeepSeek uses verified video answer ideas to produce concise, natural reference answers suited to each 45-second interview question.
**Architecture:** A server-only reference JSON maps the existing set IDs to four reviewed video summaries. The score endpoint adds reference context, validates answer length and supplies trusted provenance/timing metadata. The existing results view displays it with old-history compatibility.
**Tech Stack:** FastAPI/Pydantic, existing DeepSeek client, React/TypeScript; public video frames and local Windows OCR for source review.
**Spec:** `docs/superpowers/specs/2026-10-29-video-reference-answers-design.md`.

## Global Constraints
- Existing questions, source IDs, practice/simulation behavior and 45-second limits remain compatible.
- Target 55–75 words; server max 75, no mid-sentence truncation; one compression attempt at most.
- References are optional ideas, never a correct-answer key or a pronunciation rubric.
- Preserve all unrelated user deployment/ops changes; author EthanLyu30; proxy 12450.
- No raw video answers in final deliverables; preserve only short original source summaries and timestamps.

## Review Focus
- Wrong set ID, changed question order or old four-question clients must never attach another question's video reference.
- No video reference may leak into catalogue/questions or receive a false source label.
- A long-answer repair must preserve original grades/feedback and not silently chop an incomplete sample.
- Missing source material, disputed OCR and videos without samples must be labelled honestly.
- Old saved results and narrow mobile screens must remain usable.

### Task 1: Verify the source answer material
**Files:** Create `backend/app/data/inspire_answer_references.json`; task-only extraction/OCR helpers in `.codex-answer-reference-20261029`.
- [x] Capture tail frames with actual video timestamps, identify four Sample Answers pages and OCR their text.
- [x] Review each page against its corresponding question; paraphrase the available answer angles into concise `notes`.
- [x] Verify all 190 set identities/URLs, four references for reviewed sets and explicit reasons for non-reviewed sets; retain no raw transcripts in final JSON.

### Task 2: Reference loading and grounded, timed generation
**Files:** Create `backend/app/data/interview_answer_references.py`, `backend/tests/test_interview_answers.py`; modify `backend/app/api/interview.py`, `backend/app/schemas/interview.py`.
**Consumes:** Reference JSON from Task 1; existing `get_interview_sets()` and `DeepSeekClient.chat()`.
**Produces:** Optional request `set_id`; result fields `sample_source`, `sample_source_url`, `sample_word_count`, `sample_estimated_seconds`.
- [x] Write fixture-based failing tests for source loading/alignment, correct reference messages, no-reference fallback and legacy requests.
- [x] Run tests RED, implement strict loader and score context. Match ID plus ordered questions; legacy calls only attach a unique complete match.
- [x] Write/run RED cases for over-75-word repair and repair failures; implement a single bounded sample-only repair without changing scores/feedback.
- [x] Assert trusted source fields override model-provided metadata, score/transcripts stay deterministic, and no references leak into GET endpoints.
- [x] Run backend regression, then independently review.

### Task 3: Pass identity and show practical answer metadata
**Files:** Modify `frontend/src/lib/api.ts`, `frontend/src/hooks/useInterviewSession.ts`, `frontend/src/components/InterviewResults.tsx`, `frontend/src/learning.css` and their focused tests.
**Consumes:** Task 2 fields; `scoreInterview(items, signal?, setId?)` keeps earlier arguments compatible.
- [x] Write failing tests for set ID propagation, video/AI provenance, word/time display, and old saved results.
- [x] Run RED, implement minimal request/UI changes; preserve hint/retry/recording/persistence behavior.
- [x] Ensure model source strings cannot become trusted video links; no new fields required for older results.
- [x] Run frontend tests, lint, TypeScript and build.

### Task 4: Acceptance, release and cleanup
- [x] Run all tests and inspect actual DeepSeek outputs for sourced and unsourced sets, opposing valid stances and 55–75-word natural answers.
- [x] Test desktop/414px results, source links, both modes and old history using isolated fixtures; no production test records.
- [x] Commit backend/data first, verify deployment, then frontend; merge/push main as EthanLyu30 and verify production.
- [x] Record actual source coverage and limitations; remove owned intermediate frames/OCR/scripts/caches after resolved-path verification.

## Final Acceptance
- 174期696条视频参考要点已核实并冻结；早期16期实际无范文，明确标记not_provided。31条来源瑕疵注记，独立抽查24题通过。
- 后端329、前端150测试通过，lint/类型检查/构建通过；本地与正式站各30档结果布局通过，旧历史414px兼容。
- 真实生产范例58–61词、估算36–37秒，早期无范文题AI来源标识正确；未写生产练习记录。
- 55–75为口语目标而非最低字数：不为凑数填充内容，保留自然简洁表达；75词上限有服务端校验。评分与压缩总预算55秒。
- 后端10d222c、前端42e2a41均已作为EthanLyu30推送main，Render/Vercel及CI成功。
- 任务原始资料、测试库、脚本、缓存和构建输出已回收，所有本轮服务与独立浏览器已停止。详见[验收记录](../../video-reference-answers-qa-20261029.md)。
