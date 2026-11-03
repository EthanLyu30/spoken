# 数据库与后端区域迁移（2026-11-03）

## 问题

线上后端在 Render **Oregon**，Postgres 在 Neon **AWS Asia Pacific 1（Singapore）**。跨区域往返使每条 SQL 约 347 ms、每次连接获取约 174 ms、每次提交约 174 ms。`/api/stats` 的空数据读取也要 700 ms，带数据时约 1.2 s；写入更是多条串行 SQL 叠加。

## 迁移

1. 在 Neon 新建项目 `spoken-oregon`，区域 **AWS US West 2 (Oregon)**，与 Render 服务同区。
2. 用当前 SQLAlchemy 模型在新项目建表；按外键顺序复制 16 张表，逐表核对行数，并重置 identity 序列。
3. 暂停 Render 服务，复制期间不接收业务写入；复制完成后恢复。
4. 将 Render 的 `DATABASE_URL` 指向新项目的 pooled 连接串，手动触发一次部署。
5. 保留原 Singapore 项目 `Spoken` 作为回滚副本，未删除。

迁移期间创建的两把临时 API Key（Neon / Render）在完成后已撤销，未写入仓库。

## 迁移前后（同一台本机、同一代理出口、热连接）

| 指标 | 迁移前 | 迁移后 |
|---|---:|---:|
| `db_acquire` | ~174 ms | **~2 ms** |
| `db_query`（单条） | ~347 ms | **~3 ms** |
| `db_commit`（有写入时） | ~174 ms | **~2 ms** |
| `/api/stats` 服务端 `response_ready` | 700–1,200 ms | **9–13 ms** |
| `/api/words` 服务端 `response_ready` | 524 ms | **8 ms** |
| 首页 LCP | 2.65 s | **0.86 s** |
| 学习进度 LCP | 1.88 s | **0.86 s** |
| 个人中心 LCP | 1.98 s | **0.88 s** |
| 生词本 LCP | 1.50 s | **0.56 s** |

剩余客户端耗时主要是中国大陆到 Render 的网络（本机代理约 0.3–0.7 s/请求）；服务端数据库已不再是瓶颈。直连 Render 的线路仍可能不稳定，若要进一步降低大陆用户延迟，应将 Render 服务也迁到 Singapore/Hong Kong 一类更近的区域。

## 数据核对

- 16 张表行数逐表一致；`sessions` 92、`turns` 876、`scores` 365、`words` 172、`users` 12、`practice_records` 204、`learning_events` 564、`telemetry_records` 以迁移后新增为准。
- 用一条真实游客会话详情调用 `/api/sessions/{id}`，返回 200，消息 3 条、评分 4 项。
- 管理员 token 仍有效，`/api/auth/me` 返回 `is_admin: true`，后台概览正常。
- 迁移后新增的遥测只写入 Oregon 项目；Singapore 副本保持只读备份状态。

## 边界

- 真实麦克风、播放听感、并发容量和 Render/Neon 计费变化未在本轮验收。
- 未删除旧数据库；回滚只需把 Render 的 `DATABASE_URL` 指回旧连接串并重新部署。
- 迁移不改变前端 API 域名；Vercel 与 Render 仍是分离部署。

## 第二段：后端也迁到 Singapore（同日）

在数据库同区之后，剩余的主要延迟是大陆到 Render Oregon 的线路。随后新建：

- Render `spoken-backend-sg`，区域 **Singapore**；
- Neon `spoken-singapore`，区域 **AWS Asia Pacific 1 (Singapore)**；
- 将 Oregon 当前全部 16 张表复制到 Singapore，行数逐表一致；
- Vercel Production 的 `VITE_API_BASE_URL` 切换到 `https://spoken-backend-sg.onrender.com` 并重新部署；
- GitHub Actions 的 `BACKEND_HEALTH_URL` 变量改为新服务的 `/api/ready`。

旧 Render Oregon 服务已暂停，旧 Oregon / Singapore 数据库保留作回滚副本。

同一台本机、同一代理出口的热页面测量：

| 页面 | LCP | 主要 API |
|---|---:|---|
| 首页 | **0.32 s** | `auth/me` 0.12 s、`stats` 0.12 s |
| 学习进度 | **0.82 s** | `auth/me` 0.13 s、progress 0.22 s、stats 0.12 s |
| 个人中心 | **0.78 s** | sessions 0.23 s、stats 0.13 s |
| 生词本 | **0.58 s** | words 0.13 s |

新后端数据库阶段：`db_acquire` 约 2–3 ms、`db_query` 约 3–4 ms、`response_ready` 约 9–13 ms。大陆直连新服务的健康检查在暖连接后约 0.9–2.2 s，明显优于 Oregon 的 16 s 级失败/重试。

边界：Cloudflare Worker 的独立 Cron 仍指向旧 URL，需要手动更新或停用；真实麦克风、播放听感和并发容量仍未验收。Vercel 与 Render 仍是分离部署，前端静态资源与 API 域名各自独立。
