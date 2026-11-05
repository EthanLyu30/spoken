# 当前发布筛选与真实语音验收

分支：`pm/current-release-voice-audit`（从最新 `main` 创建；未合并、未发布生产）  
日期：2026-11-05  
范围：只做本轮两个任务；不包含商业化改动。

## 任务一：当前发布 / 全部保留

### 实现

- 后端实际版本来自运行时 `RENDER_GIT_COMMIT`，不再从遥测列表猜最新版本；`/api/admin/overview` 返回 `server_release`。
- 前端实际版本来自构建期 `VITE_RELEASE`，用于浏览器来源的当前发布。
- 概览版本选择：
  - **当前发布**（默认）：后端来源使用后端实际版本，浏览器来源使用前端实际版本。
  - **全部保留**：清空版本过滤，仍受 14 天保留策略和时间范围约束。
  - **历史版本**：可以从现有 `facets.releases` 选择单个版本；`development` / `test` / `qa` 标记为测试样本，`unknown` 显示未知版本。
- 新对话等待、语音播放结果、趋势、请求统计都使用同一版本筛选。
- 从概览进入调用诊断时，来源、操作、时间范围、版本一起带入；模型首段按后端版本，浏览器阶段按前端版本分别过滤。
- 当前发布无样本时显示明确空状态。
- 用户运营的注册数、访客数、首练率继续使用自己的时间口径，不跟随调用版本切换。
- 旧记录没有 `playback_started` 时，已有成功/失败播放结果继续计入，启动状态显示为暂无新版样本。

### 改动文件

- `backend/app/core/observability.py`：从 `RENDER_GIT_COMMIT` 读取实际后端版本。
- `backend/app/api/admin.py`：概览返回 `server_release`；接收 `experience_server_release` / `experience_browser_release`。
- `backend/app/services/telemetry.py`：后端模型阶段和浏览器阶段分别按各自版本过滤。
- `frontend/src/lib/adminApi.ts`：新增版本参数与 `server_release` 类型。
- `frontend/src/pages/Admin.tsx`：当前发布/全部保留/历史版本选择、未知/测试标记、空状态、钻取携带范围。
- `frontend/src/components/AdminUsers.tsx`：首练数据加载/不可用文案。
- 对应后端/前端测试与 `docs/performance/evidence/` 证据。

### 复现步骤

1. 切到 `pm/current-release-voice-audit`。
2. 设置后端运行时 `RENDER_GIT_COMMIT=server-current`；前端构建时设置 `VERCEL_GIT_COMMIT_SHA=browser-current`（Vite 实际读取这个变量生成 `VITE_RELEASE`），启动后端与前端。
3. 插入 `server-current` / `browser-current` / `development` / `unknown` 的遥测记录。
4. 打开 `/admin`：默认应显示当前后端版本；切到浏览器来源应使用前端版本；切到全部/历史分别清空/锁定版本。
5. 从概览进入调用诊断，检查来源、操作、时间、版本没有丢失。
6. 运行 `pytest -q`、`npm test -- --run`、`npm run typecheck`、`npm run lint`、`npm run build`。

### 验证

- 前端全量 **547 passed**；后端全量 **638 passed**；TypeScript / ESLint / 生产构建通过。
- 前端 `Admin.test.tsx` 覆盖：当前后端版本默认、全部保留、历史测试版本、未知版本、当前发布空状态、钻取时版本保留。
- 后端 `test_experience_uses_server_and_browser_releases_independently` 覆盖：后端版本和前端版本不同，模型阶段只取后端版本，浏览器阶段只取前端版本。
- 现有鉴权、14 天保留策略不变。

## 任务二：真实新聊天验收

### 覆盖范围

- Windows 11，Edge `156.0.4314.58`，Chrome `156.0.8078.75`。
- 每种浏览器：
  - 5 条文字发送；
  - 5 条通话（使用 Chrome/Edge 的 fake media WAV，内容为英文点单，循环输入；不是真实麦克风）。
- 交互 ID、打字首段/全文、通话聊天首段/全文、浏览器原生朗读启动均已采集。
- 每条通话的 `asr.finalize` 时长从现有管理员 Trace 关联取得；真实麦克风说话结束时刻没有独立声学测量。

### 打字结果（发送至各阶段，ms）

Chrome：

| # | 首段文本 | 全文 | 朗读请求后启动 | 发送至朗读启动 |
|---:|---:|---:|---:|---:|
| 1 | 950 | 951 | 601 | 1568 |
| 2 | 830 | 1044 | 229 | 1330 |
| 3 | 942 | 1120 | 201 | 1339 |
| 4 | 824 | 1076 | 305 | 1385 |
| 5 | 856 | 1024 | 170 | 1206 |

Edge：

| # | 首段文本 | 全文 | 朗读请求后启动 | 发送至朗读启动 |
|---:|---:|---:|---:|---:|
| 1 | 1058 | 1396 | 1186 | 2611 |
| 2 | 714 | 1026 | 1124 | 2148 |
| 3 | 1154 | 1472 | 2743 | 4215 |
| 4 | 934 | 1810 | 3852 | 5673 |
| 5 | 693 | 982 | 1290 | 2293 |

### 通话结果（后台 Trace + 浏览器事件，ms）

Chrome：

| # | ASR finalize | 聊天首段 | 聊天全文 | 原生朗读启动 |
|---:|---:|---:|---:|---:|
| 1 | 744.6 | 834.5 | 1106.5 | 204.7 |
| 2 | 132.8（另有 buffered 6327.9） | 1390.3 | 1637.2 | 211.0 |
| 3 | 587.4 | 1231.4 | 1492.8 | 483.0 |
| 4 | 127.2 | 843.3 | 1074.2 | 196.4 |
| 5 | 5010.8 error → buffered 5987.1 | 367.8 | 560.7 | 171.5 |

Edge：

| # | ASR finalize | 聊天首段 | 聊天全文 | 原生朗读启动 |
|---:|---:|---:|---:|---:|
| 1 | 133.6 | 953.3 | 1202.3 | 1047.8 |
| 2 | 540.7 | 882.6 | 1123.9 | 1827.5 |
| 3 | 147.0 | 629.2 | 877.8 | 2945.7 |
| 4 | 545.3 | 1126.1 | 1392.3 | 252.5（本地 Mark 回退） |
| 5 | 174.1 | 741.8 | 946.7 | 1906.7 |

说明：

- 通话使用循环 fake WAV，下一轮音频会打断当前朗读，因此 `speech.complete` 多次为 `cancelled`；这不是朗读失败。
- Edge 第 4 条出现 `Microsoft Ava ... synthesis-failed`，随后使用 `Microsoft Mark` 本机英语音色启动，启动 252.5ms；这是真实回退路径的成功证据。
- 打字样本的实际输出通过系统 loopback 另外验证：Chrome 最大 RMS 约 0.370，Edge 约 0.375，语音段前有约 1–2 秒静音；波形不是仅靠回调推断。

### 声音路径

| 路径 | 结果 |
|---|---|
| Edge 在线自然音色正常 | Ava Online 启动，成功；但启动 1.0–2.95s，是 Edge 慢样本 |
| Chrome 在线/系统音色正常 | Google US English 启动 0.17–0.60s |
| 在线音色失败 → 本机英语回退 | Edge 第 4 条 `synthesis-failed` 后 Mark 启动 252.5ms |
| 无英语音色 | 自动化浏览器在用户手势前枚举为 0；手势后 Chrome/Edge 均恢复音色。真实无音色设备未覆盖 |
| 取消/打断 | 通话下一轮音频打断当前朗读，`native_end=cancelled` 正常 |
| 未完整识别确认发送 | 仅单元测试覆盖，本轮没有真实不完整识别设备样本 |
| `$3.50` | 已发送含 `$3.50` 的打字样本，未出现提前按句号朗读；需要继续保留回归 |

### 逐轮补录与缺失值

逐轮 ID 和阶段值在 evidence JSON 中；以下是本轮被点名补齐的缺失项：

| 轮次 | interaction ID | 识别 | 模型首字 | 浏览器首段 | 全文 | 音色启动 | 实际输出 |
|---|---|---|---|---:|---:|---|---|
| Edge 通话 #5 | `4f52be9e4eda5826bf63e48931319bdc` | finalize 174.1ms | 741.8ms | 742.2ms | 947.7ms | Ava，1906.7ms | 未采集 |
| Edge 打字 #4（最慢） | `89e87e12396bd88f62d79869392f4172` | 不适用 | 934.1ms | 934.1ms | 1809.9ms | 原轮未采集；同文案补验 `d475b68f1f945f86c7ab71f806e18efb` 为 Ava，1261.0ms | 原轮未采集 |
| Edge 打字补验 | `d475b68f1f945f86c7ab71f806e18efb` | 不适用 | 1486.8ms | 1486.8ms | 1711.2ms | Ava，1261.0ms | 未采集 |

- 原 Edge 打字 #4 的 `speech` probe 对象没有记录 `utterance.voice`，因此原轮音色标为「未采集」；用**同一设备、同一入口、同一文案**补验一次，确认实际选择的是 `Microsoft Ava Multilingual Online (Natural)`，启动 1261ms。
- 两条 loopback 是**额外的独立验证轮次**，消息均为 “Hello, I would like a latte, please.”，不属于上面 5 条主表的任何 interaction ID；对应关系：
  - Chrome loopback：额外轮，最大 RMS 0.370；interaction ID **未采集**
  - Edge loopback：额外轮，最大 RMS 0.375；interaction ID **未采集**
- Edge 通话 #5 的启动 1906.7ms、音色 Ava 有 Trace/回调证据，但该轮没有同时进行 loopback，实际输出标为「未采集」。
- 真实麦克风通话：尝试过系统麦克风 + 扬声器回放合成 WAV；页面没有产生用户转写，因此标为「未采集」。本轮 5 条通话仍全部是 fake media WAV，不能冒充物理麦克风。
- 回退后的系统输出：未采集。Edge 通话第 4 条有 Ava `synthesis-failed` → Mark 252.5ms 的回调证据，但没有同时录音；下一次验证应只针对这条回退路径单独录音。

### Chrome 识别回退对账

已补脱敏 Trace：

- [Chrome #2 与 #5 的 asr/chat/native 事件](evidence/2026-11-05-chrome-asr-traces.json)

对账结果：

- **Chrome #2**：`asr.transcribe` 为 `transport=direct`，总耗时 **6327.9ms**；`asr.finalize` **132.8ms** 与其几乎同时开始（相差 3ms），是其内部收尾，不是 6.3s 之外再串行 0.13s。聊天首段在 6.33s 后才开始。
- **Chrome #5**：`asr.finalize` 先失败，耗时 **5010.8ms**；约 0.96s 后启动 `transport=buffered` 的整段识别，耗时 **5987.1ms**；两段是**串行**，合计约 **11.0s**，聊天首段才在之后出现。
- 结论：长尾主要是“先等流式 finalize，失败后再整段重试”。下一轮应先拆流式收尾、整段重试和 HTTP 回退，判断是否可以更早切换或并行准备；本轮不改识别逻辑。

### Edge 通话第 5 条证据

- [Edge 通话 #5 脱敏 Trace](evidence/2026-11-05-edge-call-5-trace.json)
- Trace 中 `speech.native_start` 为 **1906.7ms**，`voice_type=enhanced`，`transport=unknown`，`reason=started`。
- 原始浏览器 JSON 的 `start_ms` 仍为空，因此这只能证明**启动回调**为 1.91s，不能证明实际声学输出；实际输出仍标「未采集」。

### 慢样本判断

- Chrome：模型首段 0.37–1.39s，朗读启动 0.17–0.60s，未发现明显应用侧等待。
- Edge：模型首段 0.63–1.13s，但自然 Ava 朗读启动 1.0–2.95s；打字最高 3.85s。慢点主要在 **Edge 在线自然音色启动**，不是模型首字或网络。
- 当前 5 秒启动看门狗没有被耗尽；这些样本在 5 秒内启动，因此没有触发超时回退。
- 本轮没有改朗读启动逻辑：证据不支持简单缩短超时就会更快（可能牺牲自然音色），也没有完成同一设备/音色的改前改后对照。下一轮若要改，应单独评审“在线自然音色快速回退阈值”。

### 未覆盖

- iPhone Safari、macOS、Android。
- 真实物理麦克风、真实环境噪声、真实人类听感。
- 全部 20 条的真实声学输出（只对每种浏览器 1 条打字样本做了 loopback）。
- Edge 无音色设备的真实恢复引导。
- 真实用户的不完整识别确认流程。

## 证据文件

- [打字 Chrome](evidence/2026-11-05-typing-chrome.json)
- [打字 Edge](evidence/2026-11-05-typing-edge.json)
- [通话 Chrome](evidence/2026-11-05-call-chrome.json)
- [通话 Edge](evidence/2026-11-05-call-edge.json)
- [Edge 最慢打字音色补验](evidence/2026-11-05-edge-slow-voice-followup.json)
- [Chrome ASR 脱敏 Trace](evidence/2026-11-05-chrome-asr-traces.json)
- [Edge 通话 #5 脱敏 Trace](evidence/2026-11-05-edge-call-5-trace.json)

## 备注

- 本轮代码只提交分支，不合并 `main`，不发布生产；等待产品经理审查。
- 生产凭据/不可逆操作不在本报告范围内。
