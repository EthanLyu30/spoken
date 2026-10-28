# Responsive Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 修复手机布局、加快并重构学习进度、建立来源明确的新托福 Interview 练习。
**Architecture:** 原应用局部改造；并行数据与身份隔离短缓存、延迟图表、可追溯主题题库、双模式答题状态机。
**Tech Stack:** React 18, TypeScript, Zustand, CSS, FastAPI, SQLAlchemy, pytest, Vitest。
**Spec:** docs/superpowers/specs/2026-10-28-responsive-learning-design.md

## Global Constraints
- 保留暖白、珊瑚红、紧凑桌面风格与已有功能；不改用户未提交的部署文件。
- 默认练习模式；模拟四题、每题 45 秒、无准备；练习分与官方分明确区分。
- 所有题源可追溯，不混合 /100 与 /6，不显示旧身份数据。

## Review Focus
- 慢请求/可选请求失败，历史仍可用。
- 登录退出后旧请求迟到，不能串数据或保存给新身份。
- 麦克风授权迟到、双击、退出、识别失败，资源与答案安全。
- 模拟不提前展示下一题、不留无限准备时间。
- 窄屏键盘、固定底栏、长英文、图表尺寸变化不遮挡操作。

## Task 1: 题库与来源
Files: backend/app/data/interview_questions.py, backend/app/api/interview.py, backend/app/schemas/interview.py, backend/tests/test_interview.py。
Interfaces: GET /api/interview/sets; GET /api/interview/questions?set_id=... 返回原 questions 加 id/topic/source/intro/hints。
- [x] 先增加同主题四题、来源、无 AI 调用、非法题组测试并确认失败。
- [x] 实现核实题组和目录，旧 questions 协议兼容。
- [x] 跑 Interview 后端测试，记录核实来源。

## Task 2: 进度数据与页面
Files: frontend/src/hooks/useProgressData.ts, frontend/src/pages/Progress.tsx, frontend/src/lib/progressCache.ts, frontend/src/lib/api.ts, backend/app/services/practice.py。
Interfaces: 分区 sessions/stats/practice/insights/latest 及 loading/error/reload；缓存按身份隔离，成功写入练习后失效。
- [x] 先测慢报告不阻塞、统计失败仍可读历史、切换身份、缓存失效。
- [x] 实现并行请求和 30 秒内存缓存；能力查询批量预取 scores，避免 N+1。
- [x] 重构概览/趋势/能力/统一历史；图表延迟加载，分别显示评分量纲。
- [x] 跑相应前后端测试与类型检查。

## Task 3: Interview 双模式
Files: frontend/src/pages/Interview.tsx, frontend/src/components/InterviewResults.tsx, frontend/src/lib/api.ts, frontend/src/pages/Interview.test.tsx。
- [x] 先测默认练习、整套选题、模拟不泄漏题、授权/退出/失败重试。
- [x] 实现题源入口、练习确认与重录、模拟听题后自动录音、状态隔离和结果保存。
- [x] 验证四题全流程、评分失败重试与历史详情。

## Task 4: 响应式与整体验收
Files: frontend/src/ui.css, frontend/src/components/BottomNav.tsx, docs/design-qa-responsive.md。
- [x] 修复证据明确的封面裁切、触控尺寸、平板列宽及答题/报告/弹窗适配。
- [x] 跑全套前后端测试、lint、typecheck、build。
- [x] 320–1440px 多页面截图与主要交互自动验收，记录加载测量。
- [x] 独立代码审查，处理重要问题，提交并按现有授权推送/同步主线；确认代码署名 EthanLyu30。
- [x] 安全清理本轮临时截图、脚本和缓存；保留最终对比图与验收文档。

## 执行记录
- 2026-10-28：现有部署改动保留；在 codex/mobile-progress-interview 工作，不创建额外工作树。
- 前置调查：320–1024px 四个入口页无横向溢出；首页手机封面主体被文案层裁切。进度串行等待报告、静态图表依赖、统计口径已定位。
- 题库优先核实来源，视频字幕端点返回空，不能据此推断题目。

- 完成：6 组 24 题，含核实的 Inspire SpeakEasy #190；前端 126、后端 243 测试通过，lint/typecheck/build 通过。
- 审查修复：快速回访补齐未完成缓存；保存脱离答题取消信号；换题/退出停止朗读，均有回归验证。
- 上线：后台 d059951、前台 7b517ce；CI/Vercel/Render success；正式站 iPhone 11 尺寸入口验收通过。
- 收尾：80 组布局检查通过，临时库/截图/缓存和构建输出已回收；原有部署改动保持不变。详情见 docs/design-qa-responsive.md。
