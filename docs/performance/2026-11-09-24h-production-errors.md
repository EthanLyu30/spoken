# 生产 24 小时错误复盘（2026-11-09）

分支：`review/three-workstreams-20261109`  
基线：`42f10ba9532d259d8231b9b9c29ec0a867251780`  
数据源：生产 admin API（只读），当前后端 release `42f10ba...`

## 时间窗

- 记录时刻：`2026-11-09T14:22:28.277Z` / `2026-11-09T22:22:28.277+08:00`
- 名义 24h 起点：`2026-11-08T14:22:28.277Z` / `2026-11-08T22:22:28.277+08:00`
- 说明：admin `/overview?hours=24` 在请求时重新计算 cutoff，没有 `since/until` 参数；以下数字是该请求时刻的 24h 窗口，不是精确到毫秒的审计导出。

## 总览

| 来源 | 总调用 | 失败 | 超时 | 取消 | 成功率* | P50 | P95 | 采集状态 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| server | 1,225 | 0 | 0 | 5 | 100% | 2.988ms | 1,305.708ms | 未达上限，15,000 |
| browser | 5,000（上限截断） | 156 | 0 | 144 | 96.79% | 869.6ms | 7,301.7ms | **at_capacity=true，5,000 上限** |

\* 成功率为非取消样本口径。浏览器总数正好 5,000，说明 24h 浏览器数据已被采集上限截断；不能据此声称“24h 全部调用只有 5,000 次”。

当前 release：

| 来源 | release | 调用 | 失败 | 取消 |
|---|---|---:|---:|---:|
| server | `42f10ba...` | 11 | 0 | 0 |
| browser | `42f10ba...` | 44 | 0 | 0 |

## 浏览器失败分解

156 个失败事件，65 个唯一 `interaction_id`，14 个事件无 interaction；147 个带 `test_run_id`，9 个未标记。

| 维度 | 分布 |
|---|---|
| 操作 | asr.attempt 79；asr.finalize 23；voice.complete 19；speech.complete 13；speech.native_start 13；asr.transcribe 9 |
| 模型/通道 | xfyun/direct 80；browser/unknown 26；unknown/unknown 19；xfyun/relay 17；xfyun/buffered 14 |
| release | development 120；c5baab0 22；8a9eb35 5；0802f6c 5；22c2396 2；b7797ad 2 |
| stage | null 77；open 40；whole_clip 32；http_buffered 7 |
| fallback_reason | null 77；unavailable 67；timeout 6；disconnect 6 |
| reason | null 142；speech_error 11；startup_timeout 3 |
| provider_code | 11201 仅 4；其余 null |

**关键缺口**：156 条的 `error_type`、`error_cause_type`、`http_status` 全为 null；绝大多数没有 provider code、错误文本或 stage。因此“事件数”可统计，但不能仅凭这些字段判断具体供应商/解析/网络根因。

## 真实候选与测试流量

- `development` 120 条：本地/测试流量为主，保留但不计入真实用户失败。
- `c5baab0` 22 条：16 条带测试标记（`chrome-speech-repeat-20261109` 10、`chrome-speech-repeat-clean-20261109` 6）；6 条未标记：
  - 2 组 5s 朗读启动超时，时间 `2026-11-09T03:57:28Z`、`03:57:46Z`，每组包含 `speech.native_start`（5000.7ms）和 `speech.complete`（playback_started=false，5001.8/5001.9ms），无 interaction_id，无法关联到具体用户/session。
  - 1 组 ASR 结束失败：`asr.finalize` 错误 26.6ms + `voice.complete` 错误 27.1ms，interaction `13bb096d...`，时间 `03:57:32Z`；相关 ASR session 与 attempt 为 ok，错误类型未分类。
  - 其余未标记：development `asr.attempt` open/unavailable 2679ms（有 interaction，疑似本地测试）；b7797ad 两条 open/unavailable（旧版本，无 interaction）。
- 当前 release `42f10ba`：server 11 条、browser 44 条，均无错误；没有“新版本引入错误”的证据。

## 代表 Trace（脱敏前缀）

- `b23c1fbc...` / `596a90b8...`：5s startup_timeout + speech.complete error，c5baab0，无 iid。
- `254a7b2c...` / `d0b9ddf4...`：同上，c5baab0，无 iid。
- `4ae08e7e...` / `c35cb230...`：asr.finalize + voice.complete error，iid `13bb096d858017cb160ded3e51e21971`，c5baab0。
- `97dbfc51...`：development asr.attempt open/unavailable，iid `a2f20aa3...`，判断为本地测试流量。
- `a16c5a41...` / `84580221...`：b7797ad attempt open/unavailable，无 iid。

未取得完整 Trace 的服务器日志；以上只基于 telemetry 详情。没有把这些事件归因给 DeepSeek：所有失败样本的模型调用 span 未显示模型失败；ASR/speech 边界为主。

## 处置

- 本轮**没有改产品代码**：当前 release 无错误；被确认的真实候选是 2 次 5s 朗读启动超时和 1 次未分类 ASR 结束失败，均发生在旧 release `c5baab0`，且缺少可复现输入/完整日志。直接改判停或供应商策略会越过证据。
- 已确认的可观测性修复项（建议下一轮）：
  1. ASR attempt/finalize 写入 `error_type`、provider code、stage 和错误文本（当前 152/156 无 provider code）。
  2. speech.native_start/complete 增加 interaction_id 或可关联的 turn ID。
  3. admin 错误表增加按 `error_type`/`provider_code` 聚合，而不只是 outcome。
  4. 浏览器 5,000 上限应在 UI 明示“已截断”，并允许更长的保留/采样窗口。
- 测试流量与真实流量目前只能靠 `test_run_id` 区分；未标记不等于真实用户，不能把所有 9 条未标记都算作生产故障。

## 未覆盖

- 精确到 API 请求时刻的 24h 审计导出；本轮是 admin 请求时窗口。
- 5s 超时对应的真实音频、网络和浏览器状态不可得。
- 当前 release 只覆盖发布时间后的少量样本；不能证明长期稳定。
- 没有做修复前后线上对比（没有修复）。
