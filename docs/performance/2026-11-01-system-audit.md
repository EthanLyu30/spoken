# Spoken 代码、接口与加载性能审查（2026-11-01）

审查基线：`51e9593387a7b7e9834775fcc3d2ed60ffbb0ac3`。时间口径：北京时间。本文是发现清单和优化建议，不代表下列问题已经修复。

## 范围与证据

本轮检查了首页/场景入口、推荐与自定义场景、Interview 会话/评分保存/历史、单词收藏和复习、学习进度/个人中心的数据读取、身份切换、语音识别/发音评分、后台权限与遥测、静态资源与依赖。

- **可控复现**：在内存中执行真实 TypeScript store / 提取的函数，用延迟响应控制顺序；没有调用真实删除/复习接口。主审独立复现了误删单词和临时卡片无保存请求两项。
- **代码确认**：追踪从 UI 到 API、数据库的实际调用；没有用“可能的最佳实践问题”代替存在的路径。
- **线上实测**：正式站资源、三个公共只读接口各 3 次、两条真正生成的新聊天。均从本机经现有 12450 代理访问；不等于所有用户的网络或页面 LCP。
- **本地算法测试**：SQLite 内存数据库、合成事件、假讯飞 socket；没有写入生产学习数据或请求真实讯飞评分。
- **视觉受阻**：Edge 正式首页打开后，浏览器读取超时；原生窗口工具随后因无法可靠确认当前网址而停止本轮控制。未继续操作页面，没有本轮有效截图；不作整体美感、手机排版、键盘/读屏或真人麦克风/扬声器验收通过的结论。

优先级表示实施顺序：P1 优先修复数据/资源风险，P2 随后的可靠性与性能工作，P3 为一致性和维护改进。不是正式漏洞评级。

## 需要先修复的功能与资源问题

### R1 · P1 · 收藏与刷新并发时，会错误删除刚保存的单词

位置：[words.ts:77](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/store/words.ts:77)、[words.ts:119](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/store/words.ts:119)。证据：可控复现。

刷新返回的新词真实 ID 替换了临时条目，随后较晚到达的收藏 POST 响应发现临时 ID 不存在，便把它当作“用户已经取消收藏”，调用 DELETE 删除真实记录。触发顺序是：刷新在途→收藏→服务器已保存→刷新先返回真实条目→收藏响应后返回。不是所有刷新都会发生，但这个合法响应顺序存在误删路径。

主审独立执行真实 store 得到：`displayedId=123`，同时 `deletedIds=[123]`。界面仍显示记录，服务器已收到删除请求；本轮请求均为内存 mock，没有删除用户数据。

建议：用明确的取消意图/操作编号协调创建与删除，不以“临时条目消失”推断删除意图。补充刷新、收藏、取消收藏交错的回归用例。

### R2 · P2 · 复习保存失败仍显示完成；临时词条甚至不会发送复习请求

位置：[words.ts:171](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/store/words.ts:171)、[WordBag.tsx:327](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/pages/WordBag.tsx:327)。证据：可控复现与代码确认。

`review()` 吞掉网络错误，卡片立即前进并最终显示完成。刚收藏、尚未返回真实 ID 的词也能进入复习池，但负 ID 会直接返回。独立复现中，这张可见临时卡片的复习网络写入次数为 **0**。网络失败的吞错路径由代码确认，没有把它冒充一次真实线上失败。

建议：未保存条目不进入复习；为复习写入提供待保存/失败/重试状态，明确本地完成和服务器保存的区别。保存机制应与本地时区连击口径保持一致。

### R3 · P2 · Interview 重试保存缺少幂等性，可能重复记录并重复计入 XP

位置：[useInterviewSession.ts:309](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/hooks/useInterviewSession.ts:309)、[useInterviewSession.ts:397](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/hooks/useInterviewSession.ts:397)、[practice.py:25](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/practice.py:25)。证据：端到端代码追踪。

若服务器已提交、响应在途中丢失，用户点击“重试保存”会再次 POST。后端每次新建 PracticeRecord 和学习事件，没有稳定的本轮练习 ID/唯一键。普通会话已有 `client_session_id`，这里可以沿用相同的幂等设计。

建议：一轮面试生成一个稳定 ID；服务端按 owner + ID 唯一约束，重复请求返回原记录。评分、视频原答案和升级答案仍在四题完成后展示，重试保存不应重复评分或重复累计学习次数。

### R4 · P2 · 快速切换“已掌握”时，旧响应能覆盖最新选择

位置：[words.ts:148](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/store/words.ts:148)。证据：审查代理使用真实 store 的可控复现；主审核对调用和回写条件。

先标记已掌握、再取消，若响应逆序，较早的 true 覆盖较新的 false；失败回滚也只判断账号，没有判断同词条更新的操作版本。复现结果为 `latest requested=false`、`rendered=true`。

建议：按词条串行写入，或使用每词操作版本并忽略过期响应/回滚。仅在前端丢弃旧响应还不足以保证服务端最后状态，应覆盖服务端写入乱序。

### R5 · P2 · 快速点两条面试历史，可能打开之前点的那条

位置：[Progress.tsx:161](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/pages/Progress.tsx:161)、[Progress.tsx:441](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/pages/Progress.tsx:441)。证据：审查代理执行提取的真实函数复现，主审核对源码。

只禁用当前请求行，其他行仍可点击。请求没有取消或序号判断；先点 A 再点 B，B 先完成、A 后完成，最终弹层切回 A，旧请求也会清掉新请求的加载状态。

建议：取消上一条详情请求，并用请求序号保护成功、失败和 finally 三个分支。

### R6 · P2 · 跟读评分成功时，练习历史保存失败没有提示

位置：[PronounceButton.tsx:59](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/components/PronounceButton.tsx:59)。证据：代码确认。

评分先显示，随后的 `savePractice(...).catch(() => undefined)` 丢弃保存错误。用户看到分数，但历史/统计可能没有记录。

建议：保留评分结果，另外显示保存状态和可重试入口；与 R3 共用幂等保存，避免重试又增加重复记录。

### R7 · P1 · 模型、识别和评分接口缺少应用层配额与并发保护

位置：[asr.py:23](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/asr.py:23)、[pronunciation.py:19](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/pronunciation.py:19)、[interview.py:155](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/interview.py:155)、[chat.py:28](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/chat.py:28)。证据：代码确认；两条无登录公共聊天请求也正常生成回复。

游客体验是现有功能，应保留。但目前相关路由缺少统一的调用配额和供应商并发预算；ASR 签名颁发接受无身份请求，频繁调用会消耗额度并竞争资源。现有遥测限流不能保护这些模型/语音路由。**没有证据证明已经遭到滥用，也未检查云平台额外防护。**

建议：按 IP/设备/账号公平限额、签名发放频率限制、供应商全局并发上限和超额友好提示。无需先购买更高配置。

### R8 · P2 · 音频 POST 整体读入内存，缺少应用层体积上限

位置：[asr.py:48](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/asr.py:48)、[pronunciation.py:28](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/pronunciation.py:28)。证据：代码确认。

两个端点直接 `await request.body()`，之后只检查非空。过大音频并发上传可先占用内存，再进入供应商处理；不能仅依赖浏览器按钮或未知的网关限制。

建议：分块读取并累计限制，超限尽早 413；校验 PCM 时长/采样格式、参考文本大小，并为识别中继设置单次字节和时长预算。不进行生产超大包压力测试。

## 已证实的加载/等待优化点

### R9 · P2 · 收藏单词的同步数据库操作会阻塞异步事件循环

位置：[words.py:26](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/api/words.py:26)、[services/words.py:40](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/words.py:40)。证据：代码确认；没有把它说成已测得的线上卡顿根因。

`async add_word` 先同步查 SQL，再在未结束读事务/归还连接的情况下等待模型释义，最后同步写 SQL/加锁/计算统计/提交。远程数据库延迟和锁等待会阻塞当前 worker 的异步循环，并在模型等待时占着数据库连接。

建议：拆成短数据库阶段，由线程执行且在线程内管理 Session；先结束初读事务，再 await 模型，插入时保留现有加锁去重。后台读取已采用线程方式，可以复用其模式。

### R10 · P2 · 学习统计每次扫描永久学习事件，越用越慢

位置：[progress.py:110](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/progress.py:110)、[practice.py:81](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/practice.py:81)。证据：代码确认 + 本地合成数据测试。

每次统计/新增活动加载该 owner 的完整 LearningEvent 集合，再在 Python 中筛选、构造集合和排序。永久事件不会随 200 条会话或 1000 条练习源记录清理而缩小；有历史的 `/stats` 还会持有 owner 写锁。

本地 SQLite 内存数据库，真实 `lock_owner + stats_and_awards + rollback`，每组 3 次；事件均为合成复习记录，**不是生产用户或 Render 性能**：

| 事件数 | 三次耗时 ms | 中位数 ms |
|---:|---|---:|
| 1,000 | 24.25 / 9.47 / 8.99 | 9.47 |
| 10,000 | 93.79 / 67.34 / 66.96 | 67.34 |
| 50,000 | 415.66 / 422.30 / 423.47 | 422.30 |

建议：保留永久学习凭据与成就不可回退语义，改为事务内维护总量/分日聚合，或执行有界 SQL 聚合，减少锁内全量对象加载。必须回归设备时区、删源记录后的成就、重复保存和跨账号合并；不能为提速简单删除历史凭据。

### 跟读评分：录完之后，又按录音原时长上传

位置：[xf_ise.py:66](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/xf_ise.py:66)、[xf_ise.py:83](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/xf_ise.py:83)、[xf_ise.py:95](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/backend/app/services/xf_ise.py:95)。证据：真实 client + 假 socket 计数，未调用真实供应商。

16kHz/16bit PCM 每 1280 字节 sleep 40 ms。20 秒合成 PCM 实际执行了 500 次 sleep 调用，计划等待合计 **20 秒**；发送完才进入结果接收循环，并且缺少整体/最终结果等待期限。浏览器端 45 秒 fetch 超时不能替代服务端处理期限。

这部分只指**跟读发音评测**，不等同于聊天模型或 Interview 文本评分。讯飞官方同样建议 40 ms/1280B，因此不能直接移除 sleep 并声称安全提速。先增加整体期限、上传时同时读取响应；进一步考虑录音期间边录边传，重叠现有发送时间。[讯飞官方协议](https://www.xfyun.cn/doc/Ise/IseAPI.html)

### R11 · P2 · 图片体积明显超过当前首屏脚本

证据：线上真实字节数、PNG 头尺寸；资源下载耗时为本机一次样本，不是页面渲染耗时。

| 资源 | 内容字节 | 尺寸 | 单次完整获取 ms |
|---|---:|---|---:|
| 首页背景 `cafe-hero.png` | 1,350,877 | 1672×940 | 1859.1 |
| Logo/角色共用 `pip.png` | 845,032 | 1254×1254 | 481.3 |
| 场景页 `journey-map.png` | 1,540,000 | 1672×941 | 550.0 |
| 入口 JS | 92,957 / gzip 32,543 | — | 145.4 |
| React chunk | 164,489 / gzip 54,168 | — | 671.2 |
| 公共 CSS | 88,903 / gzip 18,336 | — | 392.3 |

首页引用的背景 + Pip 源图约 **2.20 MB**，脚本/React/CSS 压缩后合计 **105,047 字节**。地图属于场景页，不把它计入首页下载。Logo 槽位仅 49×59 CSS px，却使用 1254 方形源图：[Wordmark.tsx:6](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/components/Wordmark.tsx:6)、[ui.css:49](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/src/ui.css:49)。

建议：Logo 专用小尺寸资源；背景/地图做 WebP/AVIF 和适配尺寸版本，手机不要获取同一份桌面 PNG。具体压缩比例以视觉质量验收为准。本轮没有转换或改动原图。

### R12 · P2 · 带 hash 静态资源仍要求每次重新验证

上述 JS/CSS/PNG 的线上响应均为 `Cache-Control: public, max-age=0, must-revalidate`。[vercel.json](C:/Users/Administrator/.codex/worktrees/interview-rubric/spoken/frontend/vercel.json:1) 仅配置重写。React chunk 的条件请求实际返回 **304、79.9 ms**：可以复用缓存内容，但仍需往返验证，不能说完全没有缓存。

建议：只对带内容 hash 的 `/assets/` 资源配置长缓存与 immutable；入口 HTML 保持可及时更新。未带 hash 的图片先做版本化，再设置相应策略。不要把私人 API 或 HTML 一起设成长缓存。[Vercel 官方建议](https://vercel.com/docs/caching/cache-control-headers)

## 本轮线上接口与新回复计时

公共读取各 3 次，全部 200；健康服务已热，不是休眠冷启动或并发测试。gzip 已生效，不重复把“启用压缩”当成新优化。

| 接口 | 完整请求耗时 ms（三次） | 解压后 / 传输字节 |
|---|---|---|
| `/api/health` | 547.6 / 682.6 / 289.1 | 30 / 30 |
| `/api/interview/sets` | 570.5 / 297.8 / 295.3 | 79,916 / 12,564 |
| `/api/scenarios` | 882.7 / 276.1 / 287.0 | 8,649 / 3,659 |

两条咖啡馆**新回复**从公共流式接口生成，非开场白，未请求讯飞朗读，也未保存学习记录：

| 阶段 | 新回复 1 ms | 新回复 2 ms |
|---|---:|---:|
| 客户端请求→首字 | 1335.7 | 938.4 |
| 客户端请求→全文 | 1556.7 | 1196.6 |
| 提供方 TCP | 42.325 | 8.278 |
| 提供方 TLS | 17.977 | 8.160 |
| 提供方请求→响应头 | 337.424 | 303.963 |
| 提供方请求→首段文字 | 823.575 | 655.757 |
| 提供方响应头→正文 | 486.151 | 351.794 |

模型正文前仍有约 0.35–0.49 秒等待，客户端与提供方计时差约 0.28–0.51 秒，包含网络、代理、应用转发和调度等。这些不是音频播放时间；不能据两个样本计算可靠 p95，也不能据此确定免费实例 CPU 达到上限。没有改模型或付费配置，因此本轮不提供优化后收益数字。

## 可继续提升的交互与加载策略

| 模块 | 已检查状态 / 提升点 |
|---|---|
| 首页与场景 | 首页 CTA 和推荐由代码核对；大图/缓存优先处理。新用户无推荐缓存时仍依赖生成，可先展示可练的本地场景，再异步更新；“换一个”保留。服务器日推荐已有锁去重，不需要重复做缓存击穿锁。 |
| Interview | 题库进入时每次重新 GET，目录未就绪时开始按钮被禁用。约 80 KB 数据已有 gzip，主要可省的是反复请求往返；用版本化目录缓存/后台刷新，并对下一页小 chunk 适量预取。评分保存的幂等性、历史请求顺序优先于装饰调整。 |
| 单词本 | `fetchedOnce` 成功后整个会话不自动刷新；没有 TTL/焦点重验证，其他设备或标签的改变可能一直不可见。采用 owner 范围的缓存与背景刷新，提供主动刷新。当前 skipHydration 是为身份安全，不能简单取消它。 |
| 结果与复习 | 统一“评分已完成”“记录待保存/已保存/失败可重试”，避免成功分数掩盖历史丢失。全部失败消息提供可执行动作。 |
| 学习进度/个人中心 | 已有分区读取、30 秒元数据缓存与请求去重；进度图表也已 lazy + Suspense。ECharts 压缩后约 167 KB，延迟加载应保留，不能再声称它阻塞首页。继续优化统计全量扫描、写锁和刷新可靠性。 |
| 自定义场景 | 活动场景以浏览器共享 `spoken-custom-scene` 存储，而账号切换的 resetOwner 只清词汇/会话。需明确这是设备共享内容还是账号私有内容，再补充对应隔离/迁移策略；未确认产品约定，不把它描述成已发生的账号泄露。 |
| 日切一致性 | 学习统计按设备时区；首页金句和推荐缓存以 UTC 日切，每日金句又用本地日期。建议统一“今天”的口径，避免午夜后的不一致；这不是本轮测得的加载瓶颈。 |
| 状态文案 | `BackendStatus` 对普通用户显示“后端未运行 · 启动后刷新”。建议改为服务连接状态和明确重试动作，技术细节放管理员后台。这里是代码文案审查，不是截图美感评价。 |
| 语音 | 上轮 Edge 原生朗读尚未成功验收，本轮控制停止后未获得新的通过证据。本地模型当前已有显式选择门槛，不应在缺少真实设备数据时推广为默认提速方案。 |

## 依赖与可维护性

以锁文件里的 **99 个非 dev 依赖名称**向 npm 官方批量公告端点查询，命中 5 个包、8 条公告。命中版本范围不等于当前产品具有可利用路径：

| 包 / 锁定版本 | 命中与本项目的关系 |
|---|---|
| `react-router` / `react-router-dom` 6.30.4 | 两个导航重定向公告需跟踪升级；已检查的链接主要是常量或固定应用路径，未复现攻击者控制跳转。另一个 SSR 反序列化公告不适用于当前 BrowserRouter + createRoot 的声明式 SPA。见[维护者导航公告](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6)、[另一导航公告](https://github.com/remix-run/react-router/security/advisories/GHSA-jjmj-jmhj-qwj2)、[SSR 适用条件](https://github.com/remix-run/react-router/security/advisories/GHSA-337j-9hxr-rhxg)。 |
| `echarts` 5.6.0 | GHSA-fgmj-fm8m-jvvx 涉及 **Lines series** 默认 HTML tooltip；当前只注册 LineChart 和 RadarChart，不把二者混同。建议维护升级，未发现该具体触发路径。见[Apache 修复 PR](https://github.com/apache/echarts/pull/21608)。 |
| `sharp` 0.34.5 | 三条原生图像依赖公告；来自 `@huggingface/transformers` 的依赖链，浏览器静态部署没有 Node 图像服务。尚未证明可达路径，不能标成线上已可利用高危。 |
| `tar` 7.5.20 | 一条构造 tar 递归 DoS 公告；来自 `onnxruntime-node` 依赖，当前未发现接收用户 tar 的服务路径。属于依赖/构建链维护项。 |

后续应逐项选择修复版本、验证适用条件，并回归路由和图表；不能直接把公告计数当成攻击已发生的证据。后端 requirements 多为版本下界、没有部署锁文件，建议固定已验收的依赖组合并定期更新，以便同一提交可重复部署。没有进行 Python 供应链完整审计。

## 建议实施顺序与验收

1. **数据正确性与资源保护**：R1、R2、R3、R7、R8；加有意义的响应乱序/响应丢失测试和幂等约束，保留游客入口及现有学习统计口径。
2. **低风险加载收益**：R11/R12 图片尺寸/格式与 hash 资源缓存；补目录缓存、词库刷新。验收资源字节、缓存命中、重复访问请求数，以及桌面/手机真实视觉。
3. **累积数据与评分等待**：R9/R10 的数据库阶段与统计聚合；跟读整体期限、并发收结果，之后评估边录边传。用同组本地数据和线上分阶段指标做前后对比。
4. **交互一致性和维护**：R4/R5/R6、保存状态、日切/场景归属和可达依赖升级；恢复浏览器控制后补全主要页面、iPhone 与原生出声检查。

保留已经存在且有效的路由/图表懒加载、gzip、读取去重、账号代际保护、后台服务端管理员鉴权与遥测保留机制。既有 499/433 项 CI 是基线；本轮未修改运行时代码，没有重跑整套测试来掩盖尚未覆盖的并发顺序。

## 收尾与未覆盖项

本轮脚本均内联，模拟与数据库均在内存中；没有创建 helper 文件、构建产物、测试数据库或下载图片文件。只保留本审查报告。新开的正式首页测试标签在控制停止后未能确认关闭，未继续操作或标记保留。上轮系统 Temp pytest 残留不属于本轮新建文件，没有重新尝试绕过其审批拒绝。

未完成项包括正式页面完整点击/截图、iPhone Safari 实机排版、真实麦克风和扬声器、当前用户长历史接口计时、生产数据库规模/CPU/内存/冷启动/并发容量，以及云端网关额外限流配置。以上项目均没有被记为验收通过，也不能据本报告认定免费配置必须升级。
