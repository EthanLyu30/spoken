# Chrome 正常通话基线（2026-11-08）

固定音频：已验证的 7.37 秒 Zira 点单 WAV，16 kHz mono PCM。  
入口：生产 `/practice/cafe` → 语音练习 → 通话，Chrome fake media。  
测试标记：客户端 `chrome-baseline-20261108`；后端诊断字段尚未部署，因此后端 Trace 没有 test_run_id。

## 逐轮结果

时间均为该轮客户端 `performance.now()` 相对值；“说完”记录为 finalize 发送。

| # | interaction ID | finalize 发送→final | final→聊天请求 | 聊天请求→首段 | 全文完成 | 朗读请求→原生启动 | 聊天请求→原生启动 | 后端 chat Trace | 后端耗时 |
|---:|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | `b98cb75df62d2dffe9156575d5782c03` | 909.9ms | 2.4ms | 910.7ms | 1160.6ms | 未启动（interrupted） | 未完成 | `bacd340d…` | 904.6ms |
| 2 | `2cdb67b466631047949d4f9c299cea0a` | 127.9ms | 1.0ms | 829.9ms | 1204.8ms | 188.6ms | 1223.5ms | `42d053e4…` | 1100.0ms |
| 3 | `075fbf4c0b8246c7e41c66564d5180c5` | 80.3ms | 1.4ms | 694.3ms | 946.9ms | 190.6ms | 1010.0ms | `db52b0c6…` | 842.3ms |

说明：

- 第 1 轮朗读回调被后续轮次打断，未捕获到 start；第 3 轮 start 后也被打断。
- 第 2 轮朗读完整结束：Google US English，请求→start 188.6ms，start→end 约 2921.5ms。
- `原生启动` 是浏览器回调，**不是系统声学输出**；本轮未做 loopback。
- 客户端聊天耗时包含网络；后端 Trace 是独立的后端耗时，不能与客户端阶段相加。
- 三轮聊天首段远小于此前 5 秒 ASR 收尾：本轮正常 ASR finalize 为 80.3–909.9ms，没有出现 5 秒超时。

## 与 HTTP 冒烟的关系

同日 HTTP 冒烟：

- 客户端总耗时：5.66s
- 后端 ASR Trace：4.16s

本次通话三轮的后端聊天耗时分别为 0.90/1.10/0.84s；ASR 收尾为 0.08–0.91s。两者是不同入口和不同阶段，不能直接当作优化收益。

## 未覆盖

- 受控流式超时
- 受控连接断开
- 不完整转写
- 系统实际首声录音
- 后端 test_run_id / 讯飞数值错误码（诊断代码尚未部署）

证据：
[2026-11-08-chrome-normal-call-baseline.json](evidence/2026-11-08-chrome-normal-call-baseline.json)
