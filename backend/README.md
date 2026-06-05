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

## 目录结构

```
backend/
├── app/
│   ├── main.py          # FastAPI 入口、CORS、路由注册
│   ├── core/
│   │   └── config.py    # 环境变量 / 设置
│   └── api/
│       └── health.py    # 健康检查
├── requirements.txt
└── .env.example
```

> 业务模块（场景、对话、ASR/TTS、评测、报告）会随后续 PR 加入，详见根目录 `docs/ROADMAP.md`。
