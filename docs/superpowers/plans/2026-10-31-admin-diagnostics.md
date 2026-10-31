# Admin Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复失效数据库连接复用，并让私有看板更紧凑、可读、便于定位失败。

**Architecture:** 在既有 SQLAlchemy 引擎增加 checkout 前检测，新增可空异常类型字段并无损迁移。React 保留现有 API 与 ECharts，分别处理概览/列表结果，重排现有控件及详情。

**Tech Stack:** FastAPI / SQLAlchemy / SQLite & PostgreSQL / React / TypeScript / ECharts / Lucide / pytest / Vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-admin-diagnostics-design.md`

## Global Constraints

- 延续现有暖白、深棕、珊瑚色及 Lucide 图标，不新增设计栈、外部服务或公共管理入口。
- 仅保留异常类名，不保存异常消息、SQL 参数、用户问答、音频、邮箱或凭据；原有 spans JSON 数组格式不变。
- 管理员服务端授权、no-store、来源隔离、取消统计、未知 usage/TTFT 和既有评分/历史记录逻辑保持完整。
- 1440 × 1000 桌面与 390px 手机宽度验收；不生成线上演示数据，不发起付费评分请求。

## Review Focus

- 失效池连接必须在业务查询前替换，执行中断不得重放写入。
- 已存在的遥测表与历史空值应能重复迁移和读取。
- 概览或列表其中一项失败不得遮挡另一项成功结果。
- 状态过滤、分页和慢请求排序不得改变概览统计口径。
- 刷新失败时旧数据须标识；401/403 则立即清除，不得当作可用缓存展示。

### Task 1: Connection safety and failure metadata

**Files:** `backend/app/db.py`, `backend/app/models/telemetry.py`, `backend/app/core/observability.py`, `backend/app/services/telemetry.py`, `backend/tests/test_database_connections.py`, `backend/tests/test_observability.py`.

**Interfaces:** `TraceContext.record()` adds nullable `error_type`/`error_cause_type`; `serialize()` returns them without exception messages. Existing spans remain arrays.

- [ ] Add regression tests for a closed returned connection, repeated old-table migration, content-free exception capture, and old/new detail serialization.
- [ ] Run targeted pytest and verify the relevant failures before implementation.
- [ ] Enable pre-ping, add nullable model columns and idempotent migrations, capture class names on escaped and explicitly marked exceptions.
- [ ] Run targeted telemetry/database tests, then full backend suite. Expected: all pass.
- [ ] Commit the verified backend deliverable as EthanLyu30.

### Task 2: Compact, resilient dashboard

**Files:** `frontend/src/pages/Admin.tsx`, `frontend/src/admin.css`, `frontend/src/lib/adminApi.ts`, `frontend/src/pages/Admin.test.tsx`, `docs/admin-observability.md`.

**Interfaces:** Consume nullable metadata from Task 1; still accept old responses with fields absent. Overview excludes table-only outcome, list retains all filters.

- [ ] Add failing tests for all-operation defaults, separate panel failures, stale refresh labels, stable overview scope and failure detail compatibility.
- [ ] Run `npm test -- src/pages/Admin.test.tsx`; confirm intended failures.
- [ ] Implement independent result handling and the scoped filters, then refine existing layout and diagnostic details.
- [ ] Run targeted tests, full frontend suite, lint, typecheck and build. Expected: all pass.
- [ ] Update operational documentation, commit verified UI and request one fresh-context whole-branch review.

### Task 3: Deploy and verify

- [ ] Address material review findings with regression coverage; verify changed code.
- [ ] Preserve primary checkout's user-owned modifications; integrate and push main using existing authorization.
- [ ] Verify CI, Vercel and Render deployment; inspect real admin all-operation view, failure filtering and old trace details on desktop/mobile widths.
- [ ] Save a final screenshot, reset browser viewport, preserve the user's signed-in tabs and remove verified task-owned intermediate artifacts when permitted.
