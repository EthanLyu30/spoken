# 部署指南 · Deploy

Spoken 已容器化（`backend/Dockerfile`、`frontend/Dockerfile` + `nginx.conf`、`docker-compose.yml`），下面给三种部署方式。

> ⚠️ **安全与成本**：公网后端会消耗你的付费 **DeepSeek / 讯飞** 额度。建议：用带额度上限的专用 Key；演示结束后下线或加访问口令 / 限流；**绝不要把密钥提交进仓库**（`.env` 已被 gitignore）。

---

## 方式 A · 单机 Docker Compose（最简单）

适合自己的服务器 / 本机一键起全栈。

```bash
cp backend/.env.example backend/.env     # 填入 DEEPSEEK_API_KEY、XF_*
docker compose up -d --build
```

- 前端 http://localhost:5173 （nginx 托管 + 把 `/api` 反代到后端，**同源**，无需配 CORS / API 地址）
- 后端 http://localhost:8000/docs

放到公网：把 5173 端口对外（或加一层反代 + HTTPS，如 Caddy / Nginx）。

---

## 方式 B · 云端托管（前后端分离，推荐给评委试用）

### 后端 → Render（Docker，免费档）
1. Render → **New → Blueprint**，选本仓库（会读取根目录 `render.yaml`）。或手动新建 **Web Service**：Runtime=Docker、Dockerfile=`backend/Dockerfile`、Context=`backend`、Health Check=`/api/health`。
2. 在 Dashboard 填环境变量：`DEEPSEEK_API_KEY`、`XF_APP_ID`、`XF_API_KEY`、`XF_API_SECRET`、`CORS_ORIGINS=<你的前端域名>`、`DATABASE_URL=<Postgres 连接串>`（见下「数据持久化」）。
3. 容器会自动绑定 Render 注入的 `$PORT`。
   > 不配 `DATABASE_URL` 会用临时 SQLite，**重部署/休眠唤醒后数据会重置**；配上 Postgres 才能持久保存。

### 前端 → Vercel（或 Netlify，静态）
- Root Directory = `frontend`，Framework = **Vite**，Build = `npm run build`，Output = `dist`。
- 环境变量 `VITE_API_BASE_URL = <后端地址>`（如 `https://spoken-backend.onrender.com`）。

### 收尾
- 后端 `CORS_ORIGINS` 必须**包含前端域名**（逗号分隔可多个）。
- 打开前端域名验证；`<后端>/api/health` 应返回 `{"status":"ok"}`。

---

## 环境变量

| 变量 | 用途 | 必需 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 对话 / 纠错 / 出题 / 金句 | 核心必需 |
| `XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` | 讯飞：ASR、发音评测、讯飞音色 | 语音功能需要 |
| `CORS_ORIGINS` | 允许的前端来源（分离部署时设为前端域名） | 分离部署需要 |
| `DATABASE_URL` | 数据库连接串；默认临时 SQLite，设为 Postgres 则持久化 | 想持久化时需要 |

> 仅配 `DEEPSEEK_API_KEY` 即可跑通文字对话 / 限时问答 / 金句 / 自定义场景，朗读默认走浏览器语音；配上 `XF_*` 解锁语音识别、发音评测、讯飞音色。

---

## 数据持久化与多设备

- **多设备隔离（已内置，免登录）**：前端会在浏览器生成一个随机 `client_id`（存 localStorage），随每个请求带上 `X-Client-Id`；后端按它隔离数据，**每个浏览器只看到自己的生词本 / 记录 / 统计**。换浏览器或清缓存即换新身份（不是真正账号，演示足够）。
- **持久化（接 Postgres）**：默认 SQLite 在 Render 免费档是临时的（重启即重置）。要数据不丢：
  1. 在 [Neon](https://neon.tech) 或 [Supabase](https://supabase.com) 建一个**免费 Postgres**，复制连接串（形如 `postgresql://user:pass@host/db`）。
  2. 在 Render 后端的环境变量里设 `DATABASE_URL=<该连接串>`，保存后会重部署。
  3. 表会自动创建（无需手动建表）。之后生词本 / 记录就**跨重启保留**了。

> 已加入存储上限（每个设备最多保留最近 200 次会话 / 1000 条练习记录），防止数据库无限增长。

---

## 国内访问提速（自定义域名 + 保活）

国内直连 Vercel 的 `*.vercel.app` 有时会被 DNS 污染 / 路由很慢，Render 免费档闲置 ~15 分钟会休眠、冷启动要几十秒。低成本缓解：

- **自定义域名**：买个域名，在 Vercel 项目 **Settings → Domains** 添加并按提示配 DNS（自有域名比 `*.vercel.app` 稳）。加好后把后端 `CORS_ORIGINS` 加上新域名（多个用逗号分隔）。
- **保活后端**：仓库已带 `.github/workflows/keepalive.yml`，每 ~10 分钟 ping 一次 `/api/health` 让 Render 别睡（可在仓库 **Settings → Variables** 设 `BACKEND_HEALTH_URL` 覆盖默认地址）。GitHub 定时任务是「尽力而为」、可能延迟；要更稳可再挂一个 [UptimeRobot](https://uptimerobot.com)（免费，5 分钟间隔）。
- **想要国内更快**：把后端迁到香港（如 fly.io `hkg`），离用户和 DeepSeek 都近；或走 ICP 备案 + 国内 CDN（最快但最折腾）。免费版 Cloudflare 在大陆无节点，通常帮助有限、甚至更慢。

---

## 验证（任一方式）

1. `GET <后端>/api/health` → `{"status":"ok"}`
2. 打开前端，进任意场景发一句 → Pip 流式回复并朗读
3. 「限时问答」答一题 → 出分 + 范例；「跟读评分」→ 逐词 / 逐音素上色
