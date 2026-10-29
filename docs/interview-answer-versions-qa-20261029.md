# Interview 双版本答案验收（2026-10-29）

## 用户已选方案与实际实现

四题全部回答完，统一评分后进入结果页。练习和模拟都保持这个时机；新增会话测试明确断言前三题不调用评分、不产生结果，第四题结束才请求一次评分。答题期间不加载视频范文。

每题提供「DeepSeek升级版」和「视频原版」切换，默认升级版。原版直接使用已核对视频URL与逐题范文时间，用户主动查看后才加载固定youtube-nocookie.com播放器，不自动播放；可暂停/全屏及直接打开原视频。视频内容保留作者原画面，没有把思路摘要或AI补写冒充原文，也没有复制全文入库。

升级版复用已有sample_answer及来源、词数/估算用时，仍可朗读。生成与压缩共用风格，强调明确展开、自然搭配和适当句式变化，放弃机械三句与单纯缩短，保留45秒目标、最多75词、有效例子、学习者合理立场及不重复总结。范例质量仍受模型输出影响，75词上限由服务端硬校验。

旧历史、ETS和#1–#16无已核对视频范文时，明确说明原版不可用并保留AI示例。切题重置升级版，卸载旧iframe；切换版本或题目停止朗读。没有增加评分模型调用次数、API字段或数据库迁移。

## 测试与浏览器证据

- 前端结果组件TDD：初次RED为31项预期缺失功能失败；实现后定向34/34通过。前端全量39文件、169项通过；lint、TypeScript、生产构建通过。
- 后端全量329项通过，61条原有弃用警告。
- 真实DeepSeek最终抽样#190、#124、#1共12题，包含明确不同立场、多分支、空回答和无视频来源；47–64词，按产品公式约30–39秒。三组各一次模型调用，约5.6–6.1秒；原转写与来源保持，未写生产练习记录。
- 将超长且带重复收束的写作范例送入真实压缩，返回64词，仅一次模型调用，原分数与点评保持不变。
- Chrome独立结果页夹具：使用上述实际模型输出和产品样式，检查320、375、414、768、901、920、1024、1440、1920px，两种版本共18项；历史弹窗320、414、901、920、1024、1440px两种版本共12项。共30项均无横向溢出，播放器不小于200×200px，旧历史回退、切题重置与页面脚本错误0检查通过。
- 独立审查发现901px播放器只有176px宽；浏览器先复现，再在901–1050px将回答区域改为单列，覆盖结果页与更窄的历史弹窗。复核无重要未解决代码问题。
- 通过用户已指定的本机12450代理实际加载#190第2题YouTube播放器，HTTP200；人工式点击播放器后视频currentTime为273.13秒、paused=false、readyState=4、error=null，与265秒起播后约8秒一致。播放器仍受第三方网络/地区条件影响，因此始终保留原视频链接和提示，不依赖跨域iframe的load/error事件判断播放成败。
- 这里的Chrome结果夹具与钩子测试不能替代真实iPhone Safari、麦克风或听感验收。前期夹具将ReactDOM的默认导出当成命名空间，修正夹具后测试通过，没有因此改产品逻辑。

## 执行工具拒绝：已定位边界，尚未解除

原请求在执行工具CreateProcess之前返回`rejected: blocked by policy`，没有HTTP评分响应，也没有发送评分POST。它不等于线上服务返回拒绝。

可追踪事件：2026-10-29T13:06:04.924Z发起，13:06:06.102Z拒绝；外层工具调用ID为`call_a57df93aba0b42519827257adfbe09c0`。原命令是PowerShell单引号here-string中的Python脚本，调用自有生产评分接口，仅含公开题目与虚构学习者答案。后续相同请求复测仍在进程启动前被拒绝。

已完成的只读核对：

1. 从本会话记录恢复准确的1620字符命令，用PowerShell Parser.ParseInput静态解析：0错误、一个语句、一个命令。token为HereStringLiteral、Pipe、Generic、Generic、EndOfInput，YouTube URL中的`&`仍是字面内容，不能归因为引号或命令拼接错误。
2. 使用本机Codex execpolicy check检查准确的外层argv和default.rules，退出0，输出`{"matchedRules":[]}`。本地规则文件没有解释拒绝；这并不代表其他执行服务策略会允许它。[规则检查说明](https://learn.chatgpt.com/docs/agent-configuration/rules)
3. 有效会话日志为approval_policy=Never、sandbox_policy=DangerFullAccess。官方说明never不走沙箱Auto-review，所以此前将此事直接归因为“自动审批”的描述证据不足。[Auto-review说明](https://learn.chatgpt.com/docs/sandboxing/auto-review)
4. 会话、Windows沙箱与桌面日志没有包含策略命中理由。附近有客户端WebSocket重连记录，但没有建立其与拒绝的因果关系，不能当根因。线上只读/api/health返回200，/openapi.json返回200且有评分路由；这些不能代替一次生产评分验收。

需要执行服务侧为上述调用与时间提供policy-decision记录：命中规则、决策来源、明确拒绝还是失败关闭、错误相关ID。当前工具没有读取该信息的接口，无法在项目源码中修复或声称已经解除。没有变更安全配置、禁用策略或更换工具绕过拒绝，也没有向第三方发送日志。

## 交付边界

产品双版本功能与自动验收可独立完成；执行工具拒绝仍单独列为未解决事项。临时脚本、模型原始输出、浏览器配置/截图和pytest产物在任务专属目录中，核验后清理；只保留代码、设计/计划和本记录。用户原有部署/运维修改不纳入提交。

## 发布与清理完成

- 功能提交`ab0d2c02ec2eeb7105fd0b09495487f2ffa58899`已以EthanLyu30署名合并、推送main。[CI成功](https://github.com/EthanLyu30/spoken/actions/runs/40884411753)。Render部署7413862014成功，[Vercel生产部署成功](https://vercel.com/ethanlyu30s-projects/spoken/GTe3v1hHpfFiAcv323XzVPKrCfbX)。
- 正式站/interview返回200；实际读取其入口脚本与InterviewResults-x0vXiFZD.js，确认含两个版本、隐私增强播放器及暂停/全屏提示。后端/api/health返回200。本轮没有绕过执行拒绝追加生产评分POST。
- 最终定向组件/会话43项测试及最终生产构建再次通过；完整套件为前端169、后端329项。
- 已停止专属5181开发服务器，浏览器上下文关闭。精确核对工作区内任务缓存和frontend/dist路径后，将脚本、原始模型输出、截图、pytest目录、浏览器配置及构建输出回收，原路径均不存在。任务分支已删除，主分支保留最终提交。
- 用户原有部署/运维9个文件哈希逐一核对未变，仍由用户保留在工作区，未纳入此次提交。

## 继续排障：实际服务配置与反馈入口

2026-10-29本轮通过原生Codex服务的只读接口继续核查，并非重复评分POST：

- 实际运行的app-server和exec-server与先前规则检查使用同一份可执行文件；app-server版本为0.165.0-alpha.1.2。
- `app-server --print-startup-config`与`configRequirements/read`均成功返回`requirements: null`，未发现管理策略约束；`config/read`未提供额外approval_policy、approvals_reviewer、sandbox、auto_review或hooks设置。这里读取的是服务的配置来源，实际回合Never/DangerFullAccess仍以前述日志为准。
- 项目没有.codex配置层；用户managed_config.toml/requirements.toml及常见系统配置文件不存在。原生配置查询的来源元数据列出用户/系统默认路径，不代表相应文件实际存在。
- 当前服务schema暴露Guardian审阅完成通知，但没有回溯审阅理由的读取方法。只读检查本机guardian_review_feedback表，本会话记录数为0，无法从中恢复此次拒绝的理由。
- 已找到原生`feedback/upload`接口，可将诊断摘要提交给OpenAI；这涉及对外通信，需用户明确授权。拟发送内容仅含版本、错误、失败调用ID/时间和以上排除项，`includeLogs=false`、不附文件、不附会话正文或凭据。当前未发送。

本轮继续缩小了配置来源范围，但仍未找到执行服务的具体命中规则，不能宣称解除或修复。为避免绕过限制，没有再次执行被拒绝的评分命令、修改规则或调整安全配置。

用户随后明确授权发送上述脱敏报告。先使用原生feedback/save在本地试打包核验：归档仅有report.json和空manifest.json，诊断正文逐字匹配，无日志或文件附件；原生反馈自动附账户关联标识，未在文档中保存这些标识值。

已通过原生feedback/upload成功提交，includeLogs=false、extraLogFiles=[]、threadId=null，RPC无错误，返回关联编号`no-active-thread-01a18810-4fcf-7e10-88ce-e38cb96629af`、promptHash=null。这是反馈关联编号，不是已修复的证明，也不是有人受理的工单状态。报告请求执行服务提供命中规则、决策来源或失败关闭信息，并在正常策略流程内纠正问题。

本轮原生服务只读查询和本地试打包进程均已退出；诊断schema、请求草稿和试打包归档为临时文件，核验反馈回执后清理。项目业务代码和权限设置未改，具体拒绝仍需平台侧继续定位。
