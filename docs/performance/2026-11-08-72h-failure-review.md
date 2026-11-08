# 最近 72 小时失败记录复核

查询时间：`2026-11-08T14:06:42Z`（北京时间 22:06）  
范围：`hours=72`，**全部保留版本**（不传 release），`source=server/browser`，`outcome=error/timeout`  
窗口：约 `2026-11-05 22:06` 至 `2026-11-08 22:06` 北京时间。

## 总量

| 来源 | error | timeout | 合计 |
|---|---:|---:|---:|
| 后端 | 454 | 0 | 454 |
| 浏览器 | 2673 | 0 | 2673 |
| 合计 | 3127 | 0 | 3127 |

所有记录 `error_type` 和 `error_cause_type` 都是 `null`；这份遥测没有可直接汇总的异常类型字段。

## 后端失败按操作

| 操作 | 数量 | HTTP |
|---|---:|---|
| `POST /api/asr` | 448 | 503 |
| `GET /api/sessions` | 1 | 400 |
| `GET /api/progress/sessions` | 1 | 400 |
| `GET /api/practice` | 1 | 400 |
| `GET /api/words` | 1 | 400 |
| `GET /api/stats` | 1 | 400 |
| `POST /api/turn-correction` | 1 | 503 |

- 448 条 ASR 503 是绝对主体。抽样 Trace 的 ASR span 显示 `error_type=XfAsrError`，但未存讯飞原始 code，所以**不能从这批遥测证明全部都是 11201**。
- 5 条 400 都是普通读取接口，没有模型 span。
- 唯一的 turn-correction 503 中，`deepseek.chat` span 为 `outcome=ok`，不是已记录的 DeepSeek 调用失败。
- 后端没有 DeepSeek/Chat 模型错误类型的失败记录。

## 浏览器失败按操作

| 操作 | 数量 | 标注 transport |
|---|---:|---|
| `asr.attempt` | 1114 | direct/relay（按样本） |
| `voice.complete` | 758 | unknown/unknown |
| `asr.transcribe` | 454 | buffered/direct |
| `asr.finalize` | 347 | direct/relay |

按 release：

| release | 数量 |
|---|---:|
| `7926b371...` | 2475 |
| `2d5d0dc...` | 198 |

浏览器记录同样没有 `error_type`，无法把 2673 条进一步拆成“超时/断连/provider error/空结果”。现有标注只能说明它们发生在 ASR 相关阶段。

## 按发生时间

后端：

| 北京时间 | 数量 |
|---|---:|
| 2026-11-05 22:00 | 103 |
| 2026-11-05 23:00 | 345 |
| 2026-11-06 13:00 | 1 |
| 2026-11-06 14:00 | 5 |

浏览器：

| 北京时间 | 数量 |
|---|---:|
| 2026-11-05 22:00 | 1167 |
| 2026-11-05 23:00 | 1500 |
| 2026-11-06 19:00 | 2 |
| 2026-11-07 10:00 | 4 |

失败高度集中在 11 月 5 日 22–23 点，之后只有 12 条。这个时间形态与当天的自动化 ASR 测试窗口重合，不能把它当成三天里均匀发生的自然用户故障；现有记录没有测试标记，无法做纯净的生产/测试拆分。

## 有效音频冒烟

`2026-11-08T14:13:19Z` 用固定 Zira 点单音频（7.37 秒，已转 16 kHz mono PCM）请求生产 `/api/asr`：

- HTTP：200
- Trace：`1b7c560f049c4995de33fa744c56b70e`
- interaction ID：`76e8220639d1409eb47c6ff398d2bfce`
- 转写：`Hello, I would like to order a latte and a breakfast sandwich, please. Can I pay by card?`
- 与已知文案语义一致、非空
- 后端 Trace：4156.6ms，`result_class=nonempty`，connect 570.5ms / upload 1895.4ms / final 1435.6ms

这说明当前真实音频识别已可用；11 月 5 日的 11201 不能再延续为今天的状态。

## 复核补正：交互去重与阶段字段

第二个快照（`2026-11-08T14:15Z`，滚动 72h）为 3022 条失败事件；因滚动窗口/保留清理，与首份 3127 条快照相差 105 条。以下去重和阶段覆盖基于第二个快照，原始 3127 条汇总保持不变。

| 来源 | 事件 | 有 ID | 唯一 interaction ID | 缺 ID 记录 |
|---|---:|---:|---:|---:|
| 后端 | 454 | 443 | 443 | 11 |
| 浏览器 | 2568 | 2351 | 710 | 217 |

浏览器缺 ID 全部是 `asr.attempt`。后端缺 ID 包括 5 条 ASR、5 条普通 GET、1 条 turn-correction。

`asr.attempt` 阶段字段覆盖（1110 条实际 Trace）：

| 字段 | 存在 | 覆盖 |
|---|---:|---:|
| `stage` | 1110 | 100% |
| `fallback_reason` | 1110 | 100% |
| `result_class` | 3 | 0.27% |

阶段分布：`open=217`、`http_buffered=444`、`whole_clip=449`。  
失败原因分布：`unavailable=928`、`disconnect=164`、`timeout=18`。

因此：

- `timeout=0` **不能解释为没有超时**；浏览器只上报 `ok/error/cancelled`，18 条 `fallback_reason=timeout` 都落在 error 事件中。
- `fallback_reason` 是阶段内前一次尝试的原因，不能脱离 `stage` 直接当成整轮根因。
- `result_class` 基本没有在端侧失败事件中记录，无法从这批数据统计空结果/非空结果。

### 纠错 503 的阶段证据

[脱敏 Trace](evidence/2026-11-08-turn-correction-503-trace.json)：

- `POST /api/turn-correction` 返回 503
- `deepseek.chat` span：`outcome=ok`，1600.9ms
- 没有解析/校验 span
- 代码在模型返回后执行 `json.loads` 和 `TurnCorrectionResponse` 校验，失败会返回 503；但现有 Trace 不足以证明这次一定是解析失败，只能确认**不是模型请求失败**

## 补充证据

- [有效音频冒烟 JSON](evidence/2026-11-08-valid-audio-asr-smoke.json)
- [交互/阶段复核 JSON](evidence/2026-11-08-72h-dedupe-stage-summary.json)
- [纠错 503 Trace](evidence/2026-11-08-turn-correction-503-trace.json)

## 结论

- 72 小时失败记录里，没有证据支持把问题统一归因于 DeepSeek。
- 主体是 ASR 相关 503/端侧 ASR 失败；5 条普通 400 不是模型错误；1 条 turn-correction 503 的模型 span 还是成功。
- 11 月 5 日集中失败不能外推为 11 月 8 日仍在限额；固定有效音频已在 11 月 8 日 22:13 取得非空、语义正确转写。
- 现有遥测缺少 `error_type`/讯飞原始错误码，且没有测试/生产标记，无法把 3127 条（或去重快照）当成纯净的生产故障样本。

