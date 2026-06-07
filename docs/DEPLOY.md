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
2. 在 Dashboard 填环境变量：`DEEPSEEK_API_KEY`、`XF_APP_ID`、`XF_API_KEY`、`XF_API_SECRET`、`CORS_ORIGINS=<你的前端域名>`。
3. 容器会自动绑定 Render 注入的 `$PORT`。
   > 免费档无持久磁盘，SQLite 历史会在重部署后重置 —— 演示足够；要持久化就上付费磁盘或外接数据库。

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
| `DATABASE_URL` | 默认 `sqlite:///./spoken.db` | 可选 |

> 仅配 `DEEPSEEK_API_KEY` 即可跑通文字对话 / 限时问答 / 金句 / 自定义场景，朗读默认走浏览器语音；配上 `XF_*` 解锁语音识别、发音评测、讯飞音色。

---

## 验证（任一方式）

1. `GET <后端>/api/health` → `{"status":"ok"}`
2. 打开前端，进任意场景发一句 → Pip 流式回复并朗读
3. 「限时问答」答一题 → 出分 + 范例；「跟读评分」→ 逐词 / 逐音素上色
