# 架构设计 · Spoken AI 英语口语陪练

本文档说明系统的整体架构、关键技术决策与数据流，对应评审中"架构清晰度与合理性"。

## 1. 设计目标与约束

口语训练有四个核心诉求，它们直接决定了架构：

| 诉求 | 架构含义 |
|---|---|
| 对话交互自然 | 需要一个有状态的对话引擎（场景角色、历史、难度自适应） |
| 端到端低延迟 | 全链路流式；首字尽快出声 |
| 纠错精准且时机得当 | **必须拿到中间结构化数据**（转写文本 + 音素打分）；纠错不能打断对话 |
| 能力提升可量化 | 逐句打分持久化，可聚合成趋势与报告 |

## 2. 为什么用「级联管线」而非「端到端语音模型」

端到端 speech-to-speech 模型（如各家 Realtime API）延迟最低、最自然，但它**隐藏了中间转写文本，也不输出音素级发音分**。而本项目的两大特色功能——发音评测与语法纠错——恰恰依赖这些中间信号。

因此核心采用 **级联管线**：

```
麦克风 → VAD 断句 → 流式 ASR → 对话 LLM → 流式 TTS → 播放
```

代价是比端到端多一些延迟，我们通过"全链路流式 + 快慢双路"来弥补。

## 3. 快慢双路（核心架构思想）

```
                    ┌──────────────── 快路：对话主链路（低延迟优先） ───────────────┐
   🎤 ──VAD──► [ASR 流式] ──partial/final──► [对话 LLM 流式] ──句子级──► [TTS 流式] ──► 🔊
                     │
                     │ final transcript（每个用户回合的最终转写）
                     ▼
   ┌──────────────── 慢路：分析评测（异步，不阻塞对话） ────────────────┐
   │  [发音评测] 讯飞语音评测：accuracy / fluency / completeness        │
   │  [语法纠错] DeepSeek：结构化错误 + 修正 + 解释                      │
   │  [打分入库] SQLite：逐回合记录                                      │
   └──────────────► 对话结束 ──► [课后总结] ──► 📊 反馈面板 / 趋势图     │
```

- **快路**只做一件事：尽快让 AI 开口说话，保证对话流畅自然。
- **慢路**接收快路产出的最终转写与原始音频，做发音/语法分析与打分，结果异步推送到前端，不影响当前对话节奏。
- 这种解耦让"自然度/延迟"与"纠错精准度"两个相互冲突的目标各自优化，互不拖累。

## 4. 模块划分

### 4.1 后端（`backend/`，FastAPI）

```
app/
├── main.py                 # FastAPI 入口、CORS、路由注册
├── core/
│   ├── config.py           # 环境变量 / 设置（pydantic-settings）
│   └── ws_manager.py       # WebSocket 连接与会话管理
├── api/
│   ├── scenarios.py        # GET 场景列表 / 详情
│   ├── conversation.py     # WS：实时语音对话（快路编排）
│   ├── assessment.py       # 发音 / 语法评测（慢路）
│   └── reports.py          # 课后总结 / 历史趋势
├── services/
│   ├── asr_xf.py           # 讯飞流式语音识别
│   ├── tts_xf.py           # 讯飞语音合成
│   ├── pron_xf.py          # 讯飞发音评测
│   ├── llm_deepseek.py     # DeepSeek 对话 / 纠错 / 总结
│   └── vad.py              # silero-vad 断句
├── models/                 # SQLAlchemy ORM（User / Session / Turn / Score）
├── schemas/                # Pydantic 请求/响应模型
└── prompts/                # 各场景与纠错/总结的提示模板
```

### 4.2 前端（`frontend/`，React + TS）

```
src/
├── pages/
│   ├── ScenarioSelect.tsx  # 场景选择
│   ├── Conversation.tsx    # 实时对话（录音、播放、字幕）
│   └── Report.tsx          # 课后报告 / 趋势
├── components/             # 通用组件（录音按钮、字幕、评分卡、雷达图）
├── hooks/
│   ├── useAudioRecorder.ts # 麦克风采集（MediaRecorder / Web Audio）
│   └── useConversationWS.ts# 与后端的 WebSocket 双工
├── store/                  # Zustand 状态
└── lib/                    # API 客户端、音频工具
```

## 5. 实时对话数据流（一次用户回合）

1. 前端通过 WebSocket 持续推送麦克风音频帧。
2. 后端 VAD 检测到一段完整语句（用户说完）→ 触发该回合结束。
3. 流式 ASR 产出 partial（实时字幕）与 final（最终转写）。
4. final 转写 + 对话历史 → DeepSeek 流式生成 AI 回复。
5. AI 回复**按句**送入讯飞 TTS，边合成边回传音频，前端边收边播（首句尽快出声）。
6. **并行（慢路）**：用 final 转写 + 该回合原始音频做发音评测、语法纠错，结果异步推送，前端在评分卡渐进显示。
7. 该回合的分数写入 SQLite。

## 6. 数据模型（量化反馈的基础）

```
User   (id, name, created_at)
Session(id, user_id, scenario, started_at, ended_at, summary)
Turn   (id, session_id, role, text, audio_path, created_at)
Score  (id, turn_id, pron_accuracy, pron_fluency, pron_completeness,
        grammar_error_count, details_json)
```

历次 `Score` 聚合即可得到能力趋势；`Session.summary` 为课后报告。

## 7. 关键技术决策小结

| 决策 | 选择 | 理由 |
|---|---|---|
| 对话范式 | 级联管线 | 需要中间转写与音素分支撑评测 |
| 延迟优化 | 全链路流式 + 快慢双路 | 兼顾自然度与纠错精度 |
| 语音 + 发音评测 | 科大讯飞 | 国内访问稳定，发音评测成熟，单家覆盖 ASR/TTS/评测 |
| 对话 / 纠错 / 总结 | DeepSeek | 国内可达，结构化输出能力强，性价比高 |
| 后端 | FastAPI | 原生异步 + WebSocket，AI/音频生态完善 |
| 存储 | SQLite | 零配置，评委可一键复现 |

## 8. 当前实现进度（与本设计的对应）

本设计是目标蓝图；当前已落地的是「文本对话闭环」，语音与评测按里程碑推进。

**✅ 已实现**

| 设计中的模块 | 实际落地 |
|---|---|
| 场景目录（角色设定） | `backend/app/data/scenarios.py` + `app/api/scenarios.py`（`GET /api/scenarios`） |
| 对话 LLM（快路） | `backend/app/services/deepseek.py` + `services/dialogue.py` + `app/api/chat.py`（`POST /api/chat`，文本版） |
| 前端对话 | `frontend/src/pages/Conversation.tsx` → `/api/chat`；首页 `Home.tsx` 闯关地图；`Report.tsx` 报告占位 |
| 设计系统 | 自研「Pip」陪伴式 UI（`components/Buddy.tsx` 等） |

**🚧 规划中（保留上文设计）**

- 实时语音：WebSocket 编排（`ws_manager`、`api/conversation.py`）、麦克风采集与 VAD 断句。
- 讯飞接入：`services/asr_xf.py`（ASR）、`tts_xf.py`（TTS）、`pron_xf.py`（发音评测）。
- 慢路评测与持久化：`api/assessment.py`、`models/`（Session / Turn / Score）、`api/reports.py`（课后总结与趋势）。

> 说明：文本 MVP 阶段对话用 `api/chat.py`（HTTP）实现；上语音时再引入上文的 WebSocket 编排（`api/conversation.py`）。
