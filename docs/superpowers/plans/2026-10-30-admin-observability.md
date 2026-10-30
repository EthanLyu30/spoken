# Private Observability Dashboard Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已选择内置方案直接实施，沿用本会话原生执行方式。

**Goal:** 为项目所有者提供受后端权限保护的运行指标和调用链看板。

**Architecture:** 在现有数据库新增管理员关联表及脱敏 telemetry 表。纯 ASGI 请求采集、ContextVar span 与有界后台写入连接业务调用；浏览器指标作为独立、不可信样本接收。React 管理页使用现有图表库，并完全依赖后端鉴权。

**Tech Stack:** FastAPI, SQLAlchemy, httpx, React/TypeScript, ECharts, pytest, Vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-admin-observability-design.md`

## Global Constraints

- 不修改评分提示词、分制或业务历史，不增加大模型调用；不缓冲流式响应。
- 默认管理员为空；仅服务器运维脚本或带消费标记的一次性启动配置能向现有账号授权，无公开提权接口。
- 不保存原始音频、问答/提示词、认证信息、原始异常消息或签名 URL。
- 后端记录和浏览器上报分源，缺失值不等于零；UTC 存储，Asia/Shanghai 展示。
- 单端单调时钟算耗时，重叠跨度不相加；nearest-rank 分位数。
- 默认保留 14 天/20,000 条，有界异步采集，故障不阻塞原业务。

## Review Focus

- 流式响应返回 200 后发生错误或用户取消，仍须反映真实状态。
- 普通用户伪造前端状态、请求管理员详情或提交管理员字段不能读取或提权。
- 采集数据库不可用或队列满时，正常业务仍正常响应并暴露采集退化信息。
- 直连/本地语音不能被误计为完整后端指标，未知 Token 不能变成 0。
- 异步并发和用户切换不能串 trace 或展示上一个管理员的缓存数据。

### Task 1: 管理员权限与可靠采集基础

**Files:** create `backend/app/models/telemetry.py`, `backend/app/services/telemetry.py`, `backend/app/core/observability.py`, `backend/app/api/admin.py`, `backend/app/schemas/telemetry.py`, `backend/scripts/admin_user.py`, `backend/tests/test_observability.py`; modify model exports, config, main, auth response and endpoints.

**Interfaces:** `TraceContext`, `span(name, **attrs)`, `trace_attribute(key, value)`, `trace_error(kind)`; `TelemetrySink.submit(record)`, `flush()`, `close()`; `is_admin(db, user_id)` and `get_admin_user`.

- [ ] 写测试并观察失败：无授权 401/403、服务端授权可读、拒绝提权；固定样本分位数/分母/缺失计量；span 隔离与信息白名单；采集失败不影响业务。
- [ ] 实现新增表、默认拒绝、运维授权脚本、纯 ASGI 采集和有界写入。
- [ ] 实现 `/api/admin/overview`, `/api/admin/traces`, `/api/admin/traces/{id}`，所有过滤共用时间窗与权限。
- [ ] 运行 `python -m pytest tests/test_observability.py -q`。Expected: all pass。完整后端测试全绿后提交 `feat: add private telemetry collection and admin authorization`。

### Task 2: 实际调用与浏览器体验埋点

**Files:** modify DeepSeek、ASR/TTS services, interview sample repair and stream error handling; create `frontend/src/lib/telemetry.ts`, corresponding tests; modify transcription, direct ASR and speech queue call sites.

**Interfaces:** Task 1 span API；`reportTiming(operation, durationMs, options)` only accepts allowed browser metrics; `/api/telemetry/client` receives finite whitelisted data with bounded size and rate.

- [ ] RED：真实服务边界的替身 HTTP/WS 响应验证首 delta 计时、usage、错误/重试与无敏感数据；浏览器成功/失败/取消上报不改变返回值。
- [ ] 实现独立 span 与有依据的计量，浏览器识别收尾和实际开始播放的体验事件；采集不增加业务调用。
- [ ] 运行相关新测试及完整前后端测试。Expected: all pass。提交 `feat: trace speech and model latency without recording content`。

### Task 3: 私有后台界面与交付

**Files:** create `frontend/src/pages/Admin.tsx`, `frontend/src/pages/Admin.test.tsx`, `frontend/src/admin.css`, `frontend/src/lib/adminApi.ts`; modify App route, admin-only navigation, AuthUser；create `docs/admin-observability.md`。

**Interfaces:** Task 1 管理 API，`AuthUser.is_admin`，所有请求使用现有 Bearer 身份及 AbortSignal。

- [ ] RED：非管理员不能请求私有数据；空数据不造零；筛选传参一致；查看 trace；403 清空展示；退出/切号撤销未完成请求。
- [ ] 实现紧凑桌面看板、指标/趋势/列表/瀑布和浏览器体验独立口径，补齐移动端基本布局。
- [ ] 运行 `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` 和后端全套。Expected: all pass。
- [ ] 新上下文审查权限、统计、流式行为和开销；重要问题先复现失败再修复。
- [ ] 核对获授权邮箱对应现有账号 ID，安全运维授权；沿用会话既有提交/合并/push 授权发布，线上检查未授权拒绝与部署状态。
- [ ] 记录真实验收边界；清理已核验的任务缓存、依赖/构建输出及执行工作目录，保留源码、测试和必要文档。
