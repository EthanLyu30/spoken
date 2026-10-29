# Interview Answer Versions Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task by task; independent diagnostics and frontend work may follow superpowers:dispatching-parallel-agents.

**Goal:** 四题评分后，逐题查看原视频答案与自然、具体、适合45秒的DeepSeek升级版，并独立定位执行工具拒绝原因。

**Architecture:** 复用现有可信来源和sample_answer；结果页增加按需原视频播放器及版本切换，后端统一调整生成/压缩风格。评分与保存时机保持现有实现。

**Tech Stack:** React/TypeScript、Vitest、FastAPI/Python、pytest、DeepSeek。

**Spec:** ../specs/2026-10-29-interview-answer-versions-design.md

## Global Constraints

- 四题回答完统一评分后展示；答题阶段不泄露答案；75词硬上限。
- 旧历史、无范文题及来源安全验证保留；不改用户已有部署/运维文件。
- 不绕过执行拒绝、不修改安全配置。临时产物仅在专属任务目录，完成后清理。

## Review Focus

- 无来源/不安全URL时不得冒充视频原版。
- 视频时间和当前题对应；切题卸载旧播放器并停止朗读。
- 视频仅在用户查看后加载；无法访问YouTube仍可读升级版及打开来源。
- 旧历史、练习/模拟四题时机和重试保留。
- 414px与桌面可用，无横向溢出。

## Tasks

### 1. 结果页双版本
Files: frontend/src/components/InterviewResults.tsx、InterviewResults.test.tsx、frontend/src/learning.css（必要时增加独立VideoAnswer组件及测试）。Consumes: existing InterviewResult.sample_* fields. Produces: safe lazy video/upgrade views.
- [x] RED：无提前iframe、正确来源/时间、切题清理、非法URL与旧历史回退。
- [x] 实现最小UI、播放回退和响应式样式，定向测试GREEN。

### 2. 升级版风格与时机
Files: backend/app/api/interview.py；现有backend/tests/test_interview_answers.py与frontend/src/hooks/useInterviewSession.test.tsx验证兼容，不新增仅匹配提示词的测试。
- [x] 更新共用风格：适当丰富搭配和句式，具体展开，取消机械三句，保留时长及不重复要求。
- [x] 真实DeepSeek抽样写作、多分支和无视频题；验证75词上限及原评分保持。
- [x] 后端全量pytest与前端test/lint/build通过，确认四题前不调用评分。

### 3. 执行拒绝与交付
Files: 最终验收记录；诊断辅助文件仅限.codex-answer-versions-qa-20261029。
- [x] 只读核对有效策略、命令解析和本地规则，记录具体结论或不可见边界。
- [x] 桌面/414px浏览器验收，记录第三方播放器可用性实测。
- [ ] 以EthanLyu30提交、合并推送main并确认部署，清理本轮缓存和构建产物。
