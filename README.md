<div align="center">

# 🗣️ Spoken — AI 英语口语陪练

**在真实场景下，用语音和 AI 进行英语对话训练，并获得发音、语法与表达的量化反馈。**

[![Status](https://img.shields.io/badge/status-in%20development-yellow)]()
[![Backend](https://img.shields.io/badge/backend-FastAPI-009688)]()
[![Frontend](https://img.shields.io/badge/frontend-React%2BTS-61dafb)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

</div>

> ⚠️ 本项目正在持续开发中（参赛作品），功能按 [开发路线图](docs/ROADMAP.md) 分 PR 逐步交付。本 README 会随功能落地同步更新。

---

## 📖 项目简介

Spoken 是一款面向中文母语者的 **AI 英语口语陪练工具**。用户选择一个真实场景（如求职面试、餐厅点餐、商务会议），即可与 AI 角色进行**实时语音对话**；对话过程中和结束后，系统会从**发音、语法、表达**三个维度给出可量化的评测与纠错，并生成**课后总结**，帮助用户持续追踪口语能力的提升。

设计目标紧扣四个口语训练的核心诉求：

- **对话交互的自然度** —— AI 稳定扮演场景角色，能追问、能引导、难度自适应。
- **语音端到端的流畅性与低延迟** —— 流式 ASR + 流式 LLM + 逐句 TTS，"快路"优先出声。
- **纠错的精准度与时机** —— 发音/语法评测走"慢路"异步分析，不打断对话，回合结束即时反馈。
- **能力提升的可量化反馈** —— 逐句打分入库，生成趋势图与课后报告。

---

## ✨ 核心功能

| 模块 | 说明 | 状态 |
|---|---|---|
| 🎬 场景选择 | 14 个场景分 4 章（生活 / 出行 / 职场 / 社交），蜿蜒闯关地图，每个含角色设定与目标 | ✅ 已完成 |
| 💬 文本对话 | 选场景即可与 AI 伙伴 Pip 实时文字对话（DeepSeek 驱动，场景化角色扮演） | ✅ 已完成 |
| 🎙️ 实时语音对话 | 通话模式（VAD 自动断句）/ 按住说话：讯飞 ASR → DeepSeek → 讯飞 TTS 朗读 | ✅ 已完成 |
| 📊 发音评测 | 「跟读评分」词级打分（准确度 / 流利度 / 完整度），逐词上色 | ✅ 已完成 |
| ✍️ 语法 / 表达纠错 | 课后小结结构化标注错误、给出修正与解释 | ✅ 已完成 |
| 📈 能力趋势 | 历次成绩入库，ECharts 雷达 + 总分曲线 | ✅ 已完成 |
| 📝 课后总结 | 对话结束生成综合报告（评分 / 纠错 / 好用表达 / 建议） | ✅ 已完成 |
| 💡 卡壳提示 | 一键让 Pip 给出 2-3 句可参考的回答 | ✅ 已完成 |
| 📚 生词本 | 收藏好用表达，点开看释义 / 例句，闪卡复习、标记掌握 | ✅ 已完成 |
| 🏅 成长体系 | 底部导航 + 个人主页（等级 / 统计）+ 成就徽章 + 每日挑战 | ✅ 已完成 |
| 📖 每日金句 | 名人名言每日积累：听原声、影子跟读打分、收进生词本 | ✅ 已完成 |

> 状态图例：✅ 已完成 · 🧪 开发中 · 🚧 规划中

---

## 🏗️ 技术架构

采用 **级联管线（Cascaded Pipeline）** 而非纯端到端语音模型，因为发音评测与语法纠错都依赖中间的结构化数据（转写文本、音素级打分）。核心思想是**快慢双路解耦**：

```
                   ┌─────────────────── 快路（低延迟，保证对话流畅） ──────────────────┐
  🎤 麦克风 ─VAD断句─► 流式 ASR ─────► 对话 LLM ─────► 流式 TTS ─────► 🔊 播放
                        │                                                  
                        └──► 转写文本 ──┐
                                        ├──► 慢路（异步，不阻塞对话）
  对话结束 ─────────────────────────────┴──► 发音评测 + 语法纠错 + 课后总结 ──► 📊 反馈面板
```

完整设计见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

### 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 · TypeScript · Vite · Tailwind CSS · 自研「Pip」设计系统（Fredoka / Nunito）· ECharts（能力趋势图） |
| 后端 | Python 3.11 · FastAPI · WebSocket · SQLAlchemy · SQLite |
| 语音识别 / 发音评测 | 科大讯飞（流式语音听写 + 语音评测） |
| 语音合成 | 科大讯飞在线语音合成 |
| 对话 / 纠错 / 总结 | DeepSeek（`deepseek-chat`） |
| 语音活动检测 | 浏览器端能量 VAD（通话模式自动断句） |
| 部署 | Docker Compose |

---

## 📁 目录结构

```
spoken/
├── frontend/          # React + TS 前端（首页闯关地图 / 对话 / 报告）
├── backend/           # FastAPI 后端（场景目录 + DeepSeek 对话引擎）
├── docs/              # 设计文档
│   ├── ARCHITECTURE.md
│   └── ROADMAP.md
├── docker-compose.yml # 一键启动（规划中）
├── .gitignore
├── LICENSE
└── README.md
```

> 按比赛规范，前后端作为独立模块分别置于 `frontend/` 与 `backend/` 子目录，便于分别部署与启动。

---

## 🚀 快速开始

需要 **Python 3.11+** 与 **Node.js 18+**。

```bash
# 后端（默认 http://127.0.0.1:8000）
cd backend
python -m venv .venv && .venv\Scripts\activate    # Windows；macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env                              # 填入 DEEPSEEK_API_KEY（对话必需）、XF_*（语音，后续用）
uvicorn app.main:app --reload

# 前端（默认 http://localhost:5173）
cd frontend
npm install
npm run dev
```

打开 <http://localhost:5173>，进入任意场景即可与 Pip 用英文文字对话（需后端在运行且已配置 `DEEPSEEK_API_KEY`）。后端测试：`cd backend && pip install -r requirements-dev.txt && pytest`。

### 🐳 Docker 一键启动

```bash
copy backend\.env.example backend\.env     # Windows；macOS/Linux: cp backend/.env.example backend/.env
#   填入 DEEPSEEK_API_KEY（与 XF_*）

docker compose up --build
```

- 前端： <http://localhost:5173>（nginx 静态托管，并把 `/api` 反向代理到后端服务）
- 后端 API 文档： <http://localhost:8000/docs>
- SQLite 数据持久化在名为 `backend-data` 的卷中

### 🔑 环境变量

后端需要以下密钥（写入 `backend/.env`，**切勿提交到仓库**）：

| 变量 | 用途 |
|---|---|
| `XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` | 科大讯飞：语音识别、发音评测、语音合成 |
| `DEEPSEEK_API_KEY` | DeepSeek：对话、纠错、总结 |

---

## 📦 依赖与第三方服务

**前端**（详见 `frontend/package.json`）：

- React 18、React Router、Vite、TypeScript
- Tailwind CSS、clsx、tailwind-merge、lucide-react（图标）、Zustand（状态）
- @fontsource Fredoka / Nunito（自托管字体）、ECharts（趋势图，规划中）

**后端**（详见 `backend/requirements.txt`）：

- FastAPI、Uvicorn、Pydantic / pydantic-settings、python-dotenv
- httpx（DeepSeek 客户端）、websockets、SQLAlchemy（持久化，规划中）
- pytest（测试，`requirements-dev.txt`）、silero-vad（语音断句，规划中）

**第三方 AI 服务**：

- DeepSeek（`deepseek-chat`）：对话 / 纠错 / 总结
- 科大讯飞：流式语音听写（ASR）、在线语音合成（TTS）、语音评测（发音打分）—— 语音里程碑接入

> 原创部分：对话编排与场景化提示工程、快慢双路架构、发音 / 语法评测的结果结构化、能力量化，以及「Pip」陪伴式交互设计。详细版本见各模块的 `package.json` 与 `requirements.txt`。

---

## 🎬 Demo 视频

> 待发布：将上传至 Bilibili / 云盘，链接补充于此。

---

## 🗺️ 开发路线图

按"每个 PR 只做一件事"的原则分步交付，详见 **[docs/ROADMAP.md](docs/ROADMAP.md)**。

---

## 📄 License

[MIT](LICENSE) © 2026 Xiaoyang Lyu (EthanLyu30)
