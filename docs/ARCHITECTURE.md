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

实时 speech-to-speech 模型可提供音频与转写事件，也可以外接专项发音评测。当前保留级联方案，是为了复用现有讯飞与 DeepSeek 服务、独立控制成本和错误恢复；是否迁移实时语音模型，应通过真实设备上的对话延迟、英语效果与成本对比决定。

因此核心采用 **级联管线**：

```
麦克风 → AudioWorklet / VAD → 讯飞流式 ASR → 对话 LLM → 讯飞流式 PCM → 播放
```

代价是比端到端多一些延迟，我们通过"全链路流式 + 快慢双路"来弥补。

## 3. 快慢双路（核心架构思想）

```
                    ┌──────────────── 快路：对话主链路（低延迟优先） ───────────────┐
   🎤 ──VAD──► [讯飞流式 ASR / 可选 Moonshine] ──final──► [对话 LLM 流式]
                                                          │ 句子级
                                                          ▼
   🔊 ◄── [讯飞 PCM 流式 / 可选设备语音或 Kokoro] ◄──────────┘
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
- 原始 PCM 只保存在当前浏览器内存中，最多保留最近 8 个用户语音回合；不会写入 `localStorage`、数据库或会话消息。云端识别和按需发音评测会上传对应音频。

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
│   ├── tts.py              # POST /api/tts/stream：PCM 中继；/api/tts：兼容 WAV
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
    └── localSpeech/        # Worker、模型调度、缓存、性能门控与音频转换
```

## 5. 实时对话数据流（一次用户回合）

1. 前端保持一套麦克风与 VAD 音频图，优先使用独立音频线程的 AudioWorklet，每 20ms 交付一块 PCM；不支持时使用小缓冲的兼容采集。
2. 默认使用讯飞 WebSocket 识别，并显示 partial 实时字幕。只有用户选择本地模型且 Moonshine 就绪时才改用本地识别；每回合开始时锁定引擎。
3. VAD 判定用户说完后，本地 Worker 对缓冲 PCM 推理，或读取讯飞 final；任一工作线程失败都可用讯飞缓冲接口恢复该回合。
4. final 转写 + 对话历史 → DeepSeek 流式生成 AI 回复。
5. AI 回复按句排队：默认由讯飞生成 PCM，后端逐帧中继，前端保留短缓冲后连续调度播放，并预取下一句。用户可选择设备语音或本地 Kokoro；本地模型未就绪、过慢或失败时回退云端。
6. Pip 的回复完成后，用户可展开该回合的「即时纠错」；文字纠错请求与发音评测请求相互独立，失败可分别重试。
7. 文字回合只请求语法 / 表达；语音或混合输入回合仅评测实际说出的片段。PCM 只在浏览器内存短暂保留，最多 8 回合。
8. 会话结束时再生成综合课后报告并保存练习记录。

### 5.1 即时纠错、词典与朗读解析

- `POST /api/turn-correction` 接收当前用户句子、场景和可选上文，返回自然改写、中文说明以及最多 6 条结构化问题。它和聊天请求完全隔离，因此不会延迟 Pip 接话。
- `POST /api/dictionary/lookup` 接收 1–6 个英文词。前端对查询做规范化、会话级缓存和并发请求合并；后端使用最多 512 条、24 小时 TTL 的 LRU 内存缓存，避免重复调用 LLM。
- 页面英文内容由统一的交互文本组件处理：单击单词查询；存在有效短语选择时，选择优先于单击。每段文本只占一个 Tab 焦点，可用左右方向键选词。桌面端显示锚点卡片，移动端显示带安全区适配的底部抽屉。
- 云端播放不等待设备音色发现；明确选择设备语音时才等待最多 500 ms 的 `voiceschanged`，不可用时回退云端。本地模式使用已就绪的 Kokoro，并在播放当前句时预合成下一句。
- 只有用户明确选择本地模型后，才在空闲时段串行预热 Moonshine / Kokoro。推理与下载在独立 Worker 中，缓存复用后续访问；默认云端模式不下载模型。
- 开启省流量、设备内存不超过 2 GB、仅 2 个逻辑核心、无 Worker 或无 Cache Storage 时不下载模型。两个模型都会执行第二次稳态基准：Moonshine 慢于实时、Kokoro 慢于音频时长的 1.25 倍即禁用，防止本地免费方案拖慢对话。
- 讯飞 PCM 流通过 `/api/tts/stream` 逐帧返回，前端处理网络块跨采样边界、连续调度和取消。兼容接口 `/api/tts` 继续返回单个 WAV；旧后端或缺少 Web Audio 的环境保留缓冲播放路径。

### 5.2 取消、完整性与记录身份

- 新前端通过 `Accept: text/event-stream` 请求聊天的 `delta / done / error` 事件；上游缺少完成标志时不会把半句认证为成功。旧前端仍可接收纯文本协议。
- 每个通话回合有独立取消信号；插话、挂断、离开页面会取消旧生成和播放。插话检测保留最近音频，麦克风重连或音频图异步加载完成时会再次检查生命周期，避免挂断后重新开启采集。
- 每次练习分配 `client_session_id`，后端以 `(client_id, client_session_id)` 唯一约束保证重试幂等；旧会话的空标识保持原样。模型只使用最近 40 条上下文，保存接口最多保留每次练习 1000 条消息。
- 账号身份只来自有效 Bearer 凭证，设备请求不能使用保留的 `u:` 命名空间。生产及多进程部署需配置稳定私有的 `JWT_SECRET`；未配置时使用随机进程密钥，重启后需要重新登录。

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
| 朗读引擎 | 默认讯飞流式 PCM；设备语音 / Kokoro 可选 | 优先稳定音质与连续播放，本地模型由用户主动启用 |
| 语音识别 | 默认讯飞；本地模式可用 Moonshine Tiny | 默认保留实时字幕，实验性本地模式减少 ASR 请求 |
| 发音评测 | 科大讯飞 | 音素级准确度 / 流利度仍需成熟的专项评测服务 |
| 对话 / 纠错 / 总结 | DeepSeek | 国内可达，结构化输出能力强，性价比高 |
| 后端 | FastAPI | 原生异步 + WebSocket，AI/音频生态完善 |
| 存储 | SQLite | 零配置，评委可一键复现 |

## 8. 当前实现状态

| 能力 | 实际落地 |
|---|---|
| 场景对话 | `POST /api/chat` 与 `POST /api/chat/stream`；前端逐字展示，失败自动回退 |
| 实时语音 | 默认讯飞流式识别，可选 Moonshine；点击录音、通话模式、VAD 自动断句与保留开头的插话打断 |
| 发音评测 | `POST /api/pronunciation`，按需接收当前回合 PCM 并返回词级 / 音素级结果 |
| 即时纠错 | `POST /api/turn-correction` + `TurnCorrectionCard`，每个用户回合独立加载和重试 |
| 实时词典 | `POST /api/dictionary/lookup` + 全局 `DictionaryProvider`，覆盖对话、纠错、每日内容、报告和会话回看 |
| 连贯朗读 | 默认讯飞 PCM 流式播放；设备语音或 Kokoro 可选，本地未就绪或失败回退云端；兼容 WAV 接口 |
| 课后与成长 | 会话保存、综合报告、趋势、成长洞察、PDF / 打印、生词本与 SRS |

本地模型不需要 API Key；`XF_*` 仍用于发音评测和所有本地模型不可用时的 ASR/TTS 兜底，不引入新的必需环境变量。
