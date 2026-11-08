# 语音诊断部署与单轮验收

日期：2026-11-08  
后端：`b7797ad`  
前端：`0802f6c` + `8a9eb35`（共享 interaction ID）  
环境：Windows 11 / Chrome 156 / 生产 `/practice/cafe`，固定音频。  
当前线上主 bundle：`/assets/index-wDflUcJU.js`。

## 部署顺序

1. 先部署后端 `b7797ad`，确认 `server_release` 生效。
2. 检查数据库迁移：`test_run_id` 列存在；历史记录为 `null`。
3. 写入一条带 `test_run_id=voice-deploy-check-20261108` 的浏览器 telemetry，管理员 Trace 返回相同值。
4. 再部署前端；确认当前生产 bundle 为 `/assets/index-wDflUcJU.js`。

## 单轮结果

- run_id：`voice-deploy-20261108-2318`
- interaction ID：`c0b021a93edaac92788ea7356840e086`
- 同一轮后端 `/api/asr/session` 和 `/api/chat/stream` 使用同一 interaction ID
- 该 run_id 在后端 2 条、浏览器 16 条事件中一致
- 不会混入其它 interaction ID

| 阶段 | 结果 |
|---|---:|
| session 请求→响应 | 1723.4ms |
| finalize 发送→final | 170.1ms |
| final→聊天请求 | 1.4ms |
| 聊天请求→首段文本 | 1178.5ms |
| 聊天请求→全文完成 | 1350.7ms |
| 朗读请求→原生启动 | 367.1ms |
| 聊天请求→原生启动 | 1641.6ms |
| 播放完成回调事件 | 6138.8ms |
| voice.complete 事件 | 6362.6ms |

后端聊天 Trace：`819669e13283fab4eb7f38a1a55e3595`，TTFT **892.0ms**，总耗时 **1073.2ms**。

## 声学录音通路校验

使用已知 7.37 秒 Zira 音频，先录 2 秒静音再播放：

- 设备：Realtek WASAPI loopback
- 播放前 2.0 秒 RMS 为 0
- 已知音频开始后首次可闻窗口在 2.3 秒
- 最大 RMS 0.3403
- 结论：loopback 能录到实际系统输出；此校验不是通话轮次

## 仍未采集

- VAD 开始/结束的独立时间戳
- 实际声学首声（soundcard loopback 初始化失败）
- 实际声学播放完成
- 受控超时、断连、不完整转写

因此这是**部署和跨端关联验收**，不是完整正常路径或优化前后证据。

证据：
[2026-11-08-chrome-deployed-single-run.json](evidence/2026-11-08-chrome-deployed-single-run.json)
