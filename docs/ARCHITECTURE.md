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
- **慢路**按用户操作触发：文字纠错走独立请求，发音评测只在语音回合展开「即时纠错」后上传该回合 PCM；两者都不阻塞 Pip 回复。
- 这种解耦让"自然度/延迟"与"纠错精准度"两个相互冲突的目标各自优化，互不拖累。
- 原始 PCM 只保存在当前浏览器内存中，最多保留最近 8 个用户语音回合；不会写入 `localStorage`、数据库或会话消息，且只发送给发音评测请求。

## 4. 模块划分

### 4.1 后端（`backend/`，FastAPI）

```
app/
├── main.py                 # FastAPI 入口、CORS、路由注册
├── core/                   # 配置、依赖、鉴权与选择性压缩中间件
├── api/
│   ├── chat.py             # HTTP 流式 / 非流式场景对话
│   ├── asr.py              # 缓冲与 WebSocket 流式语音识别
│   ├── pronunciation.py    # POST /api/pronunciation：发音评测
│   ├── tts.py              # POST /api/tts：连续 WAV 朗读
│   ├── turn_correction.py  # POST /api/turn-correction：单回合语法 / 表达纠错
│   ├── dictionary.py       # POST /api/dictionary/lookup：单词 / 短语释义
│   └── sessions.py         # 会话记录、报告与成长洞察
├── services/
│   ├── deepseek.py         # DeepSeek HTTP 客户端
│   ├── dialogue.py         # 对话提示与流式编排
│   ├── turn_correction.py  # 单回合结构化纠错
│   ├── dictionary.py       # 词典查询与有界 TTL LRU
│   └── xf_*.py             # 讯飞 ASR / ISE / TTS 与鉴权
├── models/                 # SQLAlchemy ORM（User / Session / Practice / Word）
└── schemas/                # Pydantic 请求/响应模型
```

### 4.2 前端（`frontend/`，React + TS）

```
src/
├── pages/
│   ├── Home.tsx            # 场景地图与成长概览
│   ├── Conversation.tsx    # 实时对话（录音、播放、字幕）
│   ├── Report.tsx          # 课后报告 / 趋势
│   └── WordBag.tsx         # 生词本与 SRS
├── components/             # 通用组件（录音按钮、字幕、评分卡、雷达图）
│   ├── TurnCorrectionCard.tsx
│   └── dictionary/         # 可交互英文文本、桌面卡片 / 移动端底部抽屉
├── store/                  # Zustand：认证、会话、声音、生词
└── lib/                    # API、录音、流式 ASR、通话、词典与朗读解析
```

## 5. 实时对话数据流（一次用户回合）

1. 前端通过 WebSocket 持续推送麦克风音频帧。
2. 后端 VAD 检测到一段完整语句（用户说完）→ 触发该回合结束。
3. 流式 ASR 产出 partial（实时字幕）与 final（最终转写）。
4. final 转写 + 对话历史 → DeepSeek 流式生成 AI 回复。
5. AI 回复**按句**送入讯飞 TTS，边合成边回传音频，前端边收边播（首句尽快出声）。
6. Pip 的回复完成后，用户可展开该回合的「即时纠错」；文字纠错请求与发音评测请求相互独立，失败可分别重试。
7. 文字回合只请求语法 / 表达；语音或混合输入回合仅评测实际说出的片段。PCM 只在浏览器内存短暂保留，最多 8 回合。
8. 会话结束时再生成综合课后报告并保存练习记录。

### 5.1 即时纠错、词典与朗读解析

- `POST /api/turn-correction` 接收当前用户句子、场景和可选上文，返回自然改写、中文说明以及最多 6 条结构化问题。它和聊天请求完全隔离，因此不会延迟 Pip 接话。
- `POST /api/dictionary/lookup` 接收 1–6 个英文词。前端对查询做规范化、会话级缓存和并发请求合并；后端使用最多 512 条、24 小时 TTL 的 LRU 内存缓存，避免重复调用 LLM。
- 页面英文内容由统一的交互文本组件处理：单击单词查询；存在有效短语选择时，选择优先于单击。桌面端显示锚点卡片，移动端显示带安全区适配的底部抽屉。
- 朗读选择器先读取浏览器英文音色，并等待最多 500 ms 的 `voiceschanged`；仍没有英文音色时，当前整次朗读稳定切换到讯飞云端，避免队列中途混用引擎。
- 讯飞返回原始 PCM，后端只压缩接近数字零的异常空隙，再封装为单个 WAV；低能量发音和较长句间停顿会保留。

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
| 单回合纠错 | 按需独立请求 | Pip 先回复；用户需要时再看语法、表达与发音反馈 |
| 音频隐私 | 浏览器内存最多保留 8 回合 PCM | 不持久化录音，只在发音评测时上传 |
| 词典缓存 | 前端会话缓存 + 后端有界 TTL LRU | 减少重复等待和 LLM 调用，同时限制内存增长 |
| 朗读引擎 | 浏览器英文音色优先，缺失自动回退讯飞 | 兼顾自然、低延迟与手机兼容性 |
| 语音 + 发音评测 | 科大讯飞 | 国内访问稳定，发音评测成熟，单家覆盖 ASR/TTS/评测 |
| 对话 / 纠错 / 总结 | DeepSeek | 国内可达，结构化输出能力强，性价比高 |
| 后端 | FastAPI | 原生异步 + WebSocket，AI/音频生态完善 |
| 存储 | SQLite | 零配置，评委可一键复现 |

## 8. 当前实现状态

| 能力 | 实际落地 |
|---|---|
| 场景对话 | `POST /api/chat` 与 `POST /api/chat/stream`；前端逐字展示，失败自动回退 |
| 实时语音 | `POST /api/asr` + WebSocket 流式 ASR；按住说话、通话模式、VAD 自动断句与插话打断 |
| 发音评测 | `POST /api/pronunciation`，按需接收当前回合 PCM 并返回词级 / 音素级结果 |
| 即时纠错 | `POST /api/turn-correction` + `TurnCorrectionCard`，每个用户回合独立加载和重试 |
| 实时词典 | `POST /api/dictionary/lookup` + 全局 `DictionaryProvider`，覆盖对话、纠错、每日内容、报告和会话回看 |
| 连贯朗读 | 浏览器英文语音优先；无可用音色时自动回退讯飞单 WAV 播放，并保留自然停顿 |
| 课后与成长 | 会话保存、综合报告、趋势、成长洞察、PDF / 打印、生词本与 SRS |

以上新增能力沿用现有 `DEEPSEEK_API_KEY` 与 `XF_*` 配置，不引入新的必需环境变量。
