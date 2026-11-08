# Chrome 五轮正常通话声学测量

日期：2026-11-08  
环境：Windows 11 / Chrome 156 / 生产 `/practice/cafe` / 固定音频  
音频：7.37 秒 Zira 点单 WAV，后接 25 秒静音；每轮只输入一次。  
run_id：`chrome-5round-20261108`  
当前线上 bundle：`/assets/index-wDflUcJU.js`

## 方法

- 录音：soundcard WASAPI loopback，48 kHz / 2 ch；保存为 16 kHz mono WAV。
- 浏览器事件带 `performance.now()` 和 `Date.now()`。
- 录音起始 wall：`recording_start_wall`；声学首声 wall = 录音起始 + 检测窗口起点。
- 首声检测：50 ms 窗口，按整段峰值归一化后 RMS 阈值 **0.02**，连续 2 个窗口超阈值，取第一个窗口起点。
- 原始音频结束：`call_click_wall + 7373.4ms`（fake media 文件时长；不是物理扬声器结束）。
- VAD 判停：浏览器发送 finalize 的 wall 时间（`asr.finalize.sent`）。
- 浏览器原生启动：`speechSynthesis` start 回调。
- 实际声学首声：loopback 首个持续声音窗口。
- **不把“音频结束”与 VAD 判停视为同一时刻**；两者分别计算。

## 逐轮结果

| # | interaction ID | 后端 Trace | 后端 TTFT | 聊天首段 | 原生启动 | VAD→声学首声 | 音频结束→声学首声 | 原生→声学 | 播放完成 |
|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | `db7b49c2f97979c05ef532fed81d59dd` | `f1c686ec…` | 656.2ms | 748.6ms | 152.8ms | 1144.1ms | -675.6ms | -48.7ms | ok |
| 2 | `484e5d0881b9de93db0937f4f22c29d9` | `3c3c5ec3…` | 544.2ms | 697.6ms | 1691.3ms | 2737.6ms | 776.1ms | 121.3ms | ok |
| 3 | `f74b34a161b2ea6ee72fc7e933ad53bc` | `cf58aa10…` | 599.1ms | 715.1ms | 331.4ms | 1439.2ms | -374.4ms | 134.8ms | ok |
| 4 | `c0818cab1f84e035a7c09d2de1be911f` | `6ec0fa17…` | 765.3ms | 878.8ms | 155.1ms | 1246.9ms | -575.4ms | -52.2ms | ok |
| 5 | `b32363788d9320280f30282cd98eb6b9` | `375bb14f…` | 881.9ms | 1003.9ms | 4746.5ms | 6140.9ms | 4175.5ms | 144.4ms | ok |

- 5 轮均有 `speech.complete=ok`、`voice.complete=ok`。
- 五轮使用同一 `test_run_id`，interaction ID 各自独立。
- 五轮后端 Trace 的 `test_run_id` 也为 `chrome-5round-20261108`。

## 汇总（仅逐轮中位数/范围，不计算 P95）

| 指标 | 中位数 | 范围 |
|---|---:|---:|
| VAD 判停→声学首声 | 1439.2ms | 1144.1–6140.9ms |
| 音频结束→声学首声 | -374.4ms | -675.6–4175.5ms |
| 聊天首段 | 748.6ms | 697.6–1003.9ms |
| 原生启动回调 | 331.4ms | 152.8–4746.5ms |
| 后端 TTFT | 656.2ms | 544.2–881.9ms |

## 必须保留的异常标记

- 第 5 轮是明显异常：原生回调 4746.5ms，声学首声也在 6140.9ms，不能与其它四轮直接平均。
- 音频结束→声学首声在第 1/3/4 轮为负，因为 VAD 在 fake 音频文件名义结束前就判停，TTS 已开始；这不是负的真实等待，而是“音频文件结束”和“VAD 判停”不是同一事件。
- 第 1/3/4 轮声学首声与原生回调相差在 ±52–135ms；第 2 轮 121ms；第 5 轮异常。
- 这些是 5 次尝试的原始值，不据此计算 P95，也不据此决定优化。

## 录音

- [Round 1](evidence/audio/2026-11-08-round-1-16k.wav)
- [Round 2](evidence/audio/2026-11-08-round-2-16k.wav)
- [Round 3](evidence/audio/2026-11-08-round-3-16k.wav)
- [Round 4](evidence/audio/2026-11-08-round-4-16k.wav)
- [Round 5](evidence/audio/2026-11-08-round-5-16k.wav)

原始事件、trace ID、墙钟和录音起始时间在：
[2026-11-08-chrome-five-round-acoustic.json](evidence/2026-11-08-chrome-five-round-acoustic.json)

## 未覆盖

- 恢复路径（超时/断连/不完整转写）
- 真实物理麦克风
- 声学播放结束（只有浏览器播放完成回调）
- 第 5 轮异常的原因定位
