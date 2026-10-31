# Admin Audience and Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在私有看板提供可信的访客、模型价格/参考费用和自动清理状态。

**Architecture:** 新增匿名日活动/监测状态表，公开页面尽力上报，后台按账号权限聚合；费用按公开价计算上下界，现有遥测 schema 无需追加费用列。保留写入清理并新增启动/周期维护。

**Tech Stack:** FastAPI / SQLAlchemy / SQLite & PostgreSQL / React / TypeScript / existing ECharts.

**Spec:** `docs/superpowers/specs/2026-10-31-admin-audience-cost-design.md`

## Global Constraints

- 访客只受时间范围影响；不保存原始标识、IP、邮箱或浏览内容，不补算未采集历史。
- 费用是当前公开价参考区间，不是实扣账单；未知用量/模型不补零，浏览器样本不参与计费。
- 保持原有管理员校验、来源隔离、旧历史、评分与语音流程；不发付费模型请求。

## Review Focus

- 登录前后重叠、跨日、多设备、并发上报不能把请求数当访客数。
- 缺失稳定标识、采集禁用和存储上限不得伪装完整计数。
- 计费包含已报告用量的失败/取消调用，未知模型不能套用 Flash 单价。
- 无新增流量时也要触发周期保留清理；失败不影响主要业务，停止任务不能悬挂测试或服务。
- 访客/价格元数据必须继续受私有权限控制，客户端统计不影响页面操作。

### Task 1: Backend metrics and retention

**Files:** new `backend/app/models/monitoring.py`, `backend/app/services/monitoring.py`, `backend/app/services/model_pricing.py`, `backend/tests/test_admin_monitoring.py`; existing models init, config, telemetry service/API, admin API and lifespan.

- [ ] Write failing tests for de-duplication, privacy/auth exclusions, scope/time/capacity and unknown-safe price arithmetic.
- [ ] Implement tables/upserts, visit ingestion, overview/trace enrichment and current-rate catalog.
- [ ] Write failing no-traffic retention/learning preservation tests; extract existing limits, add startup/hourly worker and clean shutdown.
- [ ] Run focused and full backend suites, commit verified backend implementation.

### Task 2: Public-page tracking and private dashboard

**Files:** new `frontend/src/components/SiteVisitTracker.tsx`, `frontend/src/lib/siteVisits.ts` with tests; App integration, Admin/types/CSS/tests and `docs/admin-observability.md`.

- [ ] Write failing tests for guest/auth headers, anonymous-storage gaps, route/admin exclusions and failures that do not affect UI.
- [ ] Implement visit hook and best-effort client.
- [ ] Write failing dashboard tests for visitor counts, model/rates/cost unknowns, retention and source explanations.
- [ ] Add six compact indicators, model/price/cost panel, per-trace cost and clear source/retention help.
- [ ] Run full frontend tests, lint/typecheck/build and browser layout checks; commit verified implementation.

### Task 3: Review, integration and live verification

- [ ] One fresh-context read-only review; address consequential findings with regression coverage.
- [ ] Preserve existing primary-checkout changes, fast-forward and push main as EthanLyu30 using existing authorization.
- [ ] Verify CI/Render/Vercel, actual anonymous visit collection, owner exclusion and desktop/mobile dashboard. Preserve signed-in user tabs and reset temporary viewport.
- [ ] Keep final requested deliverables; remove safe task-owned intermediates or report a concrete cleanup block.
