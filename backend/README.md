# Spoken · Backend (FastAPI)

实时语音对话编排、发音/语法评测与课后总结的后端服务。

## 环境要求

- Python 3.11+

## 本地运行

```bash
cd backend

# 1) 创建并激活虚拟环境
python -m venv .venv
.venv\Scripts\activate            # Windows (PowerShell/CMD)
# source .venv/bin/activate       # macOS / Linux

# 2) 安装依赖
pip install -r requirements.txt

# 3) 配置环境变量
copy .env.example .env            # Windows
# cp .env.example .env            # macOS / Linux
#   然后按需填入 XF_* 与 DEEPSEEK_API_KEY（骨架阶段可留空）

# 4) 启动服务
uvicorn app.main:app --reload
```

服务默认监听 `http://127.0.0.1:8000`。

## 验证

- 健康检查： <http://127.0.0.1:8000/api/health> → `{"status":"ok","app":"Spoken"}`
- 交互式 API 文档： <http://127.0.0.1:8000/docs>

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/scenarios` | 场景列表（后端为唯一数据源） |
| `GET` | `/api/scenarios/{id}` | 单个场景详情（含开场白） |
| `POST` | `/api/chat` | 一轮场景化角色扮演对话（DeepSeek 驱动） |
| `POST` | `/api/feedback` | 课后小结：结构化评分 / 纠错 / 建议（DeepSeek 驱动） |
| `POST` | `/api/sessions` | 保存一次完成的对话（含评分） |
| `GET` | `/api/sessions` | 历史会话列表 |
| `GET` | `/api/sessions/{id}` | 单次会话详情（对话 + 评分） |

`POST /api/chat` 接收场景 id 与历史消息，返回 AI 陪练的下一句话。历史为空时直接返回脚本化开场白（不调用模型）；有用户消息时调用 DeepSeek，因此需要在 `.env` 中配置 `DEEPSEEK_API_KEY`。

```bash
# 开场白（无需 API Key）
curl -s http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"cafe","messages":[]}'

# 一轮对话（需要 DEEPSEEK_API_KEY）
curl -s http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"cafe","messages":[{"role":"user","content":"Can I get a latte?"}]}'
```

设计上对话走**快路径**：系统提示要求 AI 全程角色扮演、回复简短口语化、不在对话中纠错（纠错与评测属于后续里程碑的慢路径）。

会话持久化使用 SQLite（默认 `spoken.db`，可用 `DATABASE_URL` 覆盖）；`/api/sessions` 用于保存与回看历史，是能力趋势的基础。

## 测试

```bash
pip install -r requirements-dev.txt
pytest
```

测试使用 FastAPI `TestClient`，通过依赖覆盖打桩 DeepSeek 客户端，**无需网络或真实 API Key** 即可运行。

## 目录结构

```
backend/
├── app/
│   ├── main.py            # FastAPI 入口、CORS、路由注册
│   ├── core/
│   │   └── config.py      # 环境变量 / 设置
│   ├── api/
│   │   ├── health.py      # 健康检查
│   │   ├── scenarios.py   # 场景目录接口
│   │   ├── chat.py        # 对话接口
│   │   ├── feedback.py    # 课后小结接口
│   │   └── sessions.py    # 会话历史接口
│   ├── data/
│   │   └── scenarios.py   # 场景定义（含角色设定，唯一数据源）
│   ├── db.py              # SQLAlchemy 引擎 / 会话 / 依赖
│   ├── models/            # ORM 模型（Session / Turn / Score）
│   ├── schemas/           # Pydantic 请求/响应模型
│   └── services/
│       ├── deepseek.py    # DeepSeek 异步客户端
│       ├── dialogue.py    # 系统提示 / 消息编排
│       ├── feedback.py    # 课后小结提示与结构化解析
│       └── sessions.py    # 会话持久化
├── tests/                 # pytest 用例
├── requirements.txt
├── requirements-dev.txt
└── .env.example
```

> 语音链路（ASR/TTS）、发音评测与报告等功能随后续 PR 加入，详见根目录 `docs/ROADMAP.md`。
