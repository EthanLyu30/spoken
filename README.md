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
| 🎬 场景选择 | 面试 / 点餐 / 会议等多场景，每个场景含角色设定与目标 | 🚧 规划中 |
| 🎙️ 实时语音对话 | 麦克风采集 → 流式识别 → AI 回复 → 语音合成播放 | 🚧 规划中 |
| 📊 发音评测 | 词级 / 音素级打分（准确度、流利度、完整度） | 🚧 规划中 |
| ✍️ 语法 / 表达纠错 | 结构化标注错误、给出修正与解释 | 🚧 规划中 |
| 📈 能力趋势 | 历次成绩入库，可视化提升曲线 | 🚧 规划中 |
| 📝 课后总结 | 一次对话结束后生成综合报告 | 🚧 规划中 |

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
| 前端 | React 18 · TypeScript · Vite · Tailwind CSS · shadcn/ui · ECharts |
| 后端 | Python 3.11 · FastAPI · WebSocket · SQLAlchemy · SQLite |
| 语音识别 / 发音评测 | 科大讯飞（流式语音听写 + 语音评测） |
| 语音合成 | 科大讯飞在线语音合成 |
| 对话 / 纠错 / 总结 | DeepSeek（`deepseek-chat`） |
| 语音活动检测 | silero-vad |
| 部署 | Docker Compose |

---

## 📁 目录结构

```
spoken/
├── frontend/          # React + TS 前端（待 PR 搭建）
├── backend/           # FastAPI 后端（待 PR 搭建）
├── docs/              # 设计文档
│   ├── ARCHITECTURE.md
│   └── ROADMAP.md
├── docker-compose.yml # 一键启动（待添加）
├── .gitignore
├── LICENSE
└── README.md
```

> 按比赛规范，前后端作为独立模块分别置于 `frontend/` 与 `backend/` 子目录，便于分别部署与启动。

---

## 🚀 快速开始

> 完整的本地运行步骤会随前后端骨架的 PR 合入逐步补全。当前预期流程如下：

```bash
# 后端
cd backend
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
cp .env.example .env                              # 填入 API Key
uvicorn app.main:app --reload

# 前端
cd frontend
npm install
npm run dev
```

### 🔑 环境变量

后端需要以下密钥（写入 `backend/.env`，**切勿提交到仓库**）：

| 变量 | 用途 |
|---|---|
| `XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` | 科大讯飞：语音识别、发音评测、语音合成 |
| `DEEPSEEK_API_KEY` | DeepSeek：对话、纠错、总结 |

---

## 📦 依赖与第三方服务

本项目使用了以下第三方框架 / 服务（原创部分为：对话编排管线、发音/语法评测的提示工程与结果结构化、能力量化与反馈面板）：

- **前端框架**：React、Vite、Tailwind CSS、shadcn/ui、ECharts
- **后端框架**：FastAPI、SQLAlchemy、silero-vad
- **第三方 AI 服务**：科大讯飞（语音）、DeepSeek（大模型）

> 详细版本见各模块的 `package.json` 与 `requirements.txt`。

---

## 🎬 Demo 视频

> 待发布：将上传至 Bilibili / 云盘，链接补充于此。

---

## 🗺️ 开发路线图

按"每个 PR 只做一件事"的原则分步交付，详见 **[docs/ROADMAP.md](docs/ROADMAP.md)**。

---

## 📄 License

[MIT](LICENSE) © 2026 Xiaoyang Lyu (EthanLyu30)
