# 新回复等待：分段定位、优化及验收（2026-11-01）


本轮关注有历史上下文的新回复，不使用首页/开场白缓存，不升级付费配置。保留当前 DeepSeek Flash、thinking disabled、温度 0.85、max_tokens 300、40 条历史窗口及整段浏览器朗读/云端完整音频。

## 结论与口径


生产暖链路全文返回中位数本轮仅有小幅变化，可能仍在采样波动内，不能证明所有新回复都有稳定提速。主要时间在模型首字及客户端到服务端的路径，结束帧与客户端清理在这批样本中只有毫秒级。本轮没有 CPU/内存使用率证据，不能据此认定免费实例已到算力上限；第一次健康预热曾超时 20 秒，原因未定，也不能用后续暖请求排除冷启动或代理问题。

用户反馈：Edge 的个人设置页单独试听显示“浏览器语音，几乎立即出声”。这验证该设备本次试听能够快速发声；版本未确认，未给毫秒数，不能当作新聊天回复的端到端首声。

基线代码 `8465ecb88791259129e08394f83cbd454367867a`；功能代码 `82dab38fc89afbc09d8be7e23d6a501689ea60e7`。

| 线上 Node Fetch 指标（ms；各 9 条） | 优化前 | 优化后 |
|---|---:|---:|
| 响应头到达中位数 | 532.5 | 489.4 |
| 首段文字中位数 | 1320.5 | 1292.3 |
| 最后文字回调中位数 | 1540.0 | 1513.2 |
| 全文返回中位数 | 1557.8 | 1515.8 |
| 结束帧到函数返回中位数 | 0.9 | 0.7 |
| 平均回复词数 | 17.3 | 17.1 |

全文中位数变化 2.7%。这组先后上线观测未控制时变网络、采样噪声和模型输入缓存，不能将全部差异归因于提示词。

## 优化后服务端分段（9 条）


| 指标 | 中位数 ms | 含义 |
|---|---:|---|
| `llm_headers` | 277.1 | 模型请求开始到提供方响应头（累计，含连接等） |
| `llm_first_text` | 813.9 | 模型请求开始到首个非空文本 |
| `llm_last_text` | 1008.9 | 模型请求开始到最后文本 |
| `llm_done` | 1009.3 | 模型请求开始到终止标记 |
| `llm_tail` | 0.1 | 最后文本到终止标记 |
| `llm_tcp` | 13.1 | 建连阶段 |
| `llm_tls` | 9.3 | TLS 阶段 |
| 输出生成段：last−first | 227.0 | 可直接归属的后续输出时间 |
| 客户端 first−服务端 first | 487.6 | 近似入口/网络/转发开销，不能等同服务器 CPU |

累计阶段不可相加。后端时钟不含用户浏览器、ASR 或物理音响；客户端这里是 Node24 Fetch 经同一个本机代理，直连生产后端 API，不是 Edge 页面。9 条输入缓存命中均为 512 token，未命中 170–184 token；基线尚无这些计数，无法做其缓存归因。

## 同模型提示词交替对照（24 次，12 对）

六类合成上下文（点单、低糖推荐、机场、技术晨会、明确语言解释、燕麦奶/过敏上下文），各两轮，交替请求旧版/新版。使用同一现有密钥和本地提供方客户端；不经过生产浏览器，不能与上一表直接相减。所有请求 200、stop、无 reasoning 文本，未截断答案。只替换两条日常对话风格要求：有用时简短回应；日常一般 10–25 词、至多一个相关追问，必要信息/直接语言问题允许更长。公共策略、场景隔离和历史保持。

| 对照指标（每版 12 条） | 旧 | 新 |
|---|---:|---:|
| 首字中位数 ms | 644.9 | 658.9 |
| 完成中位数 ms | 929.3 | 887.7 |
| 输出段中位数 ms | 279.3 | 246.4 |
| 平均词数 | 19.6 | 17.0 |
| 平均输出 token | 26.0 | 22.2 |

首字无稳定改善；完成中位数约改善 4.5%。8/12 对新版更快，但晨会的一对反而慢约 395 ms。日常八条/版输出段中位数 268.7→217.2 ms，平均词数 16.25→13.625；解释/上下文四条/版仍允许更充分信息。提示词增加 17 输入 token，输出平均减少 3.75 token，不能包装成输入压缩或大幅端到端提速。

| 题型/轮次 | 旧首字 | 新首字 | 旧完成 | 新完成 | 旧输出段 | 新输出段 | 旧/新词数 |
|---|---:|---:|---:|---:|---:|---:|---|
| coffee/1 | 674.4 | 471.9 | 937.7 | 608.4 | 263.1 | 136.4 | 15/11 |
| recommend/1 | 530.8 | 508.5 | 845.9 | 783.1 | 315.0 | 274.6 | 19/17 |
| airport/1 | 499.4 | 421.1 | 784.3 | 645.4 | 284.4 | 224.3 | 12/12 |
| standup/1 | 686.1 | 659.0 | 960.7 | 906.0 | 274.2 | 246.7 | 18/17 |
| language/1 | 629.7 | 856.2 | 1034.6 | 1175.4 | 404.6 | 318.7 | 29/28 |
| context/1 | 768.8 | 671.3 | 1165.6 | 951.3 | 396.8 | 279.7 | 25/20 |
| coffee/2 | 605.7 | 324.4 | 803.3 | 493.8 | 197.5 | 169.4 | 14/11 |
| recommend/2 | 595.9 | 687.5 | 920.9 | 936.1 | 319.7 | 246.0 | 22/17 |
| airport/2 | 689.7 | 728.0 | 838.4 | 923.5 | 148.3 | 194.9 | 13/13 |
| standup/2 | 219.0 | 658.7 | 474.1 | 869.4 | 253.8 | 210.1 | 17/11 |
| language/2 | 981.7 | 734.7 | 1352.9 | 1057.7 | 369.0 | 322.7 | 28/27 |
| context/2 | 660.1 | 379.9 | 940.6 | 687.4 | 263.5 | 288.9 | 23/20 |

首轮示例：

- coffee：旧（15词）“Oh nice, coffee it is! What size are you thinking — small, medium, or large?”
  新（11词）“Great choice! What size would you like, small, medium or large?”

- recommend：旧（19词）“Ooh, good pick! Our flat white is a favourite, nice and smooth without being sugary. Want to try that?”
  新（17词）“Our flat white's a good pick, nice and smooth without being sweet. Want it small or large?”

- airport：旧（12词）“Oh lovely, London! Alright, and will you be checking any bags today?”
  新（12词）“Lovely. Are you checking any bags today, or just carrying hand luggage?”

- standup：旧（18词）“Oh nice, love a good bug fix. So today's mostly testing that login fix, yeah? Anything blocking you?”
  新（17词）“Nice, good progress on that login bug. Any blockers you want to flag before you start testing?”

- language：旧（29词）“Oh, sure! Decaf just means it's coffee with the caffeine taken out, so it won't keep you up. Would you like to try it, or stick with the regular?”
  新（28词）“Sure! Decaf means the coffee has had most of the caffeine removed, so it won't keep you wired. Want to stick with regular, or give decaf a try?”

- context：旧（25词）“Oh nice, a latte! We've got whole milk, skim, almond, and oat. Since you mentioned oat earlier, want me to go with oat for that?”
  新（20词）“Oat milk would be perfect for you, and we've got it ready. What size would you like, small or large?”

## 实现与回归范围


- 打字/录音识别后的发送，以及通话普通接口回退，在请求模型前开始独立音色发现。准备对象不抢占全局播放、不朗读、不获取云端音频或下载本地模型；最终 React 自动朗读读取最新偏好及音色清单。静音、旧请求、鉴权变化和离开页面均清理；手动重播及发送完成时机保留。
- 原生合成器处于 paused 时条件调用 resume，避免已知空闲时多余 cancel。规范规定 cancel 和 speak 都不会清除 paused，原代码在该条件下可能等满 5 秒再回退。本轮保留 5 秒启动保护；此修复是条件恢复，并未证实用户当前新对话卡顿恰是 paused。不会切句、不会在已开声后重播云端。
- 每个原生尝试恰好记录一次启动/超时/异常/取消结果，即使之后云端成功也保留原生失败。只上报固定原因、错误枚举、三位状态、音色类别和明确选择匹配布尔值，不上传名称、URI 或错误原文。
- 成功 speech.native_start 仍从 speak 前到 onstart；speech.first_audio 与通话 voice.first_audio 原口径不变。新增 chat.first_text/complete/tail，以及打字/ASR结束后提交到播放回调的 speech.request_to_audio，并用不含身份的随机交互 ID 关联。管理员文案说明回调口径，非物理声学测量。
- 收到有效完成帧后启动 reader.cancel、接住拒绝并释放锁，全文不再等待异步清理；部分流/错误/取消/UTF-8 和旧纯文本响应兼容。原样本 cancel 约 0.3–4 ms，并不是本批数秒等待的主要原因；回归验证的是挂起清理不会阻塞已完成回复。

自动门禁：后端 529 通过；最终前端 65 文件/415 通过，lint、typecheck 和 build 通过。Native 时钟回归、通话回退静音回归都先红后绿；模块审查、整批审查及一次集中修补复审通过。已有 Browserslist、React Router 和后端弃用提示保留。

真实 Edge 页面控制因工具无法可靠校验网址而停止，本轮未继续操作或改用其他 UI 自动化绕过。没有新的聊天麦克风实录或仪器首声测量；受控语音替身只能证明状态、取消、回调和失败分支。用户的快速试听反馈单独记录。


## 逐条线上样本

基线采样结束 UTC：2026-11-01T02:17:39.209Z；优化后：2026-11-01T02:33:14.765Z。每阶段先健康预热，再 coffee→airport→standup 顺序循环三次，串行、同代理、同历史/用户输入；全部保留，无挑选重试。

- coffee/cafe 历史：“Hi there, welcome in! What can I get started for you today?”；用户：“I'd like a cup of coffee, please.”
- airport 历史：“Good morning! May I see your passport, please? And where are you flying to today?”；用户：“I'm traveling to London for five days.”
- standup 历史：“Morning! Let's keep it short and sweet. What did you work on yesterday?”；用户：“I fixed a login bug yesterday and will test it today.”

HTTP 全部 200、done=true、无错误帧。测量脚本在内存转译对应版本 parser；新版 parser 的浏览器专属 reportTiming 导入被测试桩替换，未传可选 timing 参数，未向线上伪造浏览器记录。未调用保存学习记录、评分、ASR 或 TTS 接口。


### 优化前

| 场景/轮次 | 头 ms | 首文 ms | 末文 ms | done ms | 返回 ms | done→返回 ms | cancel ms | 词数 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| coffee/1 | 286.3 | 946.6 | 1168.9 | 1170.2 | 1174.8 | 4.5 | 4.0 | 14 |
| airport/1 | 532.5 | 1361.9 | 1540.0 | 1557.0 | 1557.8 | 0.8 | 0.7 | 21 |
| standup/1 | 793.8 | 1464.2 | 1798.6 | 1798.8 | 1799.7 | 0.9 | 0.8 | 20 |
| coffee/2 | 509.7 | 1280.0 | 1458.4 | 1458.4 | 1458.8 | 0.4 | 0.3 | 16 |
| airport/2 | 884.8 | 1627.8 | 1875.8 | 1875.6 | 1877.4 | 1.8 | 1.4 | 11 |
| standup/2 | 908.6 | 1714.1 | 1938.2 | 1939.5 | 1940.6 | 1.1 | 1.0 | 18 |
| coffee/3 | 641.5 | 1155.5 | 1408.1 | 1409.9 | 1410.6 | 0.7 | 0.6 | 20 |
| airport/3 | 480.9 | 1118.6 | 1356.9 | 1357.1 | 1358.3 | 1.2 | 1.1 | 18 |
| standup/3 | 499.0 | 1320.5 | 1635.6 | 1636.9 | 1637.5 | 0.6 | 0.5 | 18 |

### 优化后

| 场景/轮次 | 头 ms | 首文 ms | 末文 ms | done ms | 返回 ms | done→返回 ms | cancel ms | 词数 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| coffee/1 | 270.4 | 910.3 | 1139.3 | 1139.9 | 1142.1 | 2.2 | 2.1 | 17 |
| airport/1 | 519.3 | 1051.2 | 1262.5 | 1264.6 | 1265.0 | 0.4 | 0.3 | 21 |
| standup/1 | 507.1 | 1439.7 | 1741.9 | 1742.1 | 1743.0 | 1.0 | 0.9 | 15 |
| coffee/2 | 505.1 | 1330.4 | 1513.2 | 1515.1 | 1515.8 | 0.7 | 0.6 | 11 |
| airport/2 | 505.0 | 1088.1 | 1313.5 | 1313.6 | 1314.3 | 0.7 | 0.6 | 21 |
| standup/2 | 489.4 | 912.4 | 1227.3 | 1229.0 | 1229.8 | 0.9 | 0.8 | 19 |
| coffee/3 | 482.9 | 1356.1 | 1564.4 | 1564.9 | 1567.1 | 2.3 | 2.2 | 12 |
| airport/3 | 479.9 | 1292.3 | 1518.7 | 1519.2 | 1519.6 | 0.3 | 0.3 | 18 |
| standup/3 | 485.6 | 1383.9 | 1648.3 | 1649.0 | 1649.8 | 0.7 | 0.7 | 20 |

### 优化后逐条服务端阶段


| 场景/轮次 | 首文 ms | 末文 ms | done ms | 头 ms | TCP ms | TLS ms | 命中/未命中 token |
|---|---:|---:|---:|---:|---:|---:|---|
| coffee/1 | 638.8 | 869.9 | 870.4 | 285.4 | 14.2 | 11.9 | 512/184 |
| airport/1 | 537.8 | 750.1 | 750.2 | 268.9 | 8.6 | 9.3 | 512/170 |
| standup/1 | 934.9 | 1235.3 | 1235.4 | 292.5 | 9.0 | 8.7 | 512/179 |
| coffee/2 | 826.9 | 1008.9 | 1009.3 | 271.4 | 13.1 | 8.7 | 512/184 |
| airport/2 | 583.1 | 810.1 | 810.2 | 320.6 | 8.5 | 9.4 | 512/170 |
| standup/2 | 424.8 | 740.5 | 740.7 | 271.9 | 15.3 | 9.9 | 512/179 |
| coffee/3 | 873.4 | 1082.9 | 1083.0 | 272.3 | 15.1 | 8.8 | 512/184 |
| airport/3 | 813.9 | 1040.5 | 1040.9 | 277.1 | 14.0 | 10.8 | 512/170 |
| standup/3 | 901.9 | 1166.5 | 1166.6 | 279.3 | 11.7 | 9.0 | 512/179 |

基线 airport/2 原始 done−末文回调约 −0.2 ms：监测器先在同一原始包观察 done，再执行 parser 的末文回调，是观察顺序/分辨率差异，不是负的物理时延。全文返回及首文统计不受此影响。开始采样前首次 health 预热 20 秒超时，之后 Python health 601.5 ms、Node health 637.1 ms，再完整执行上述九条；预热异常没有丢弃为“从未发生”。

## 发布和清理记录


- [功能提交](https://github.com/EthanLyu30/spoken/commit/82dab38fc89afbc09d8be7e23d6a501689ea60e7) 已快进合并并 push main，author/committer 的 GitHub 登录均为 EthanLyu30。主检出九个原有用户改动以 SHA256 核对保持；未重写历史。
- [功能 CI 41265558308](https://github.com/EthanLyu30/spoken/actions/runs/41265558308) 的 Python3.11 后端与 Node20 前端均通过；Render 部署 7467554829 成功，新 SSE 九条均含新增阶段字段。
- 首次功能推送后，前端一度仍是基线 8465ecb；随后文档/前端 README 提交 `8d7fe38068c6c11d8670c25e945b9d1b07347435` 触发并完成 [Vercel 部署](https://vercel.com/ethanlyu30s-projects/spoken/7BWy4Mw5796szVwdrKLcDyG8XchS)，Production 记录 7467632308。首次事件未出现部署的具体原因未确定，不能说是代码构建失败。
- UTC 02:41:09 再次从正式域名读取公共构建产物：`/assets/index-BAG6VhQP.js` 返回 200，包含完整 8d7fe38 提交号及 `speech.request_to_audio`、`startup_timeout`、`chat.complete` 新字段。`82dab38..8d7fe38` 仅文档/README 改动，已确认该生产前端含本轮全部运行时代码；代码产物核对不等于真实网页点击验收。
- [8d7fe38 CI 41266043345](https://github.com/EthanLyu30/spoken/actions/runs/41266043345) 的前后端门禁均通过，Render 部署 7467623498 成功。最终报告/计划收尾提交不改变运行时代码。
- 冒烟：健康 200、无 owner 的学习进度 400、游客 X-Client-Id 学习进度 200（sessions/insights/latest）、未登录后台 401。初次误用 user_id 查询参数被正确拒绝，修正的是测试脚本；没有放宽数据归属校验。
- 最终发布验证后，以精确路径和递归目标/符号链接检查，使用不带 Force 的 PowerShell Remove-Item 清掉本轮 15 个目录及 pytest-current 链接：任务 SDD 脚本/数据/审查包、frontend/dist、Vite 缓存、后端 pytest 缓存和本轮字节码、pytest-1/2/3 临时目录。检查目标均已消失。用户原文件、旧 scripts/__pycache__、依赖、.env、数据库及宿主工作树保留，九个原有用户改动再次核对未变。浏览器停止控制后，临时“运行”窗口是否关闭无法确认；命令没有执行。

## 实施裁决与代价


1. 使用独立音色准备，保留既有 React 自动播放；代价是一个可释放的准备对象及生命周期测试，避免模型等待期抢占手动重播和改变 busy/耗时口径。
2. 经交替样本后采用两条更简洁的日常提示；代价是多 17 输入 token、普通回答倾向更短，直接语言解释及必要信息仍可展开。数据只支持小幅完成加速，不支持首字或整体大幅提速。
3. 修复静音后最多 500 ms 的回退音色监听残留；代价是一个专用引用及针对性回归，保留旧请求不能清掉新准备对象的所有权检查。

依据：[Web Speech cancel/speak/resume 规范](https://webaudio.github.io/web-speech-api/#dom-speechsynthesis-cancel)、[DeepSeek 流式终止/usage 字段](https://api-docs.deepseek.com/api/create-chat-completion/)。
