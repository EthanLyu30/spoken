# 本地语音模型实测：Moonshine 与 Kokoro

日期：2026-11-04  
环境：Windows，Intel Core i5-13500H（12 核 / 16 线程），31.7GB RAM，Node.js 24.18，`@huggingface/transformers` 3.8.1，`kokoro-js` 1.2.1，CPU 推理（`device: "cpu"`）。  
目的：回答“本地模型是否真的能跑、效果如何”，不是生产浏览器验收，也不是与讯飞的大样本对比。

## 测试方法

- 用 Windows SAPI 生成 3 句英文，分别使用：
  - `Microsoft Zira Desktop`（美式英语音色），作为“清晰原生音”；
  - `Microsoft Huihui Desktop`（中文音色读英文），作为“带中文口音”的粗略代理。
- 音频转成 16kHz 单声道 Float32，再送入模型。
- Moonshine：`onnx-community/moonshine-tiny-ONNX`，`encoder_model=fp32`，`decoder_model_merged=q8`。
- Kokoro：`onnx-community/Kokoro-82M-v1.0-ONNX`，`dtype=q8`，音色 `af_heart`；合成后再用 Moonshine 回读，检查可懂度。
- WER 按空格分词、去标点后计算；RTF = 推理毫秒 / 音频毫秒，越小越快。
- 只测 6 条合成音频，不代表真实学习者、噪声、停顿、口音多样性。

## Moonshine 识别

模型加载（含首次下载）：**4086 ms**。

| 样本 | 音频 | 推理 | RTF | WER |
|---|---:|---:|---:|---:|
| 原生 1 | 3.16s | 185ms | 0.06 | 0% |
| 原生 2 | 4.02s | 154ms | 0.04 | 0% |
| 原生 3 | 5.01s | 237ms | 0.05 | 0% |
| 中文音色 1 | 3.91s | 118ms | 0.03 | 0% |
| 中文音色 2 | 5.14s | 210ms | 0.04 | 0% |
| 中文音色 3 | 6.19s | 237ms | 0.04 | 0% |

6 条全部逐字正确。这个结果只能说明**干净合成音上的识别链路正确、延迟很低**；不能推断真实中文口音、吞音、连读和环境噪声下仍为 0 WER。

## Kokoro 合成

模型加载（含首次下载）：**12605 ms**。

| 文本 | 输出音频 | 合成 | RTF | Moonshine 回读 WER |
|---|---:|---:|---:|---:|
| 1 | 3.00s | 2106ms | 0.70 | 0% |
| 2 | 4.08s | 2830ms | 0.69 | 0% |
| 3 | 4.92s | 3568ms | 0.72 | 0% |

合成音频可被 Moonshine 完整回读，说明可懂度在测试样本上没问题；**没有做人耳自然度评分**。RTF 约 0.7，即合成 3 秒语音要 2.1 秒，低于项目 1.25 的性能闸门，但在低端设备/浏览器 WASM 下可能更慢，甚至被闸门禁用。

## 下载体积

| 组成 | 约 |
|---|---:|
| Moonshine encoder fp32 | 30.9 MB |
| Moonshine decoder q8 | 20.2 MB |
| Kokoro q8（WASM） | 92.4 MB |
| Kokoro q4f16（WebGPU，可用时） | 154.6 MB |
| ONNX Runtime WASM | 21.6 MB |
| 两个 worker JS | 3.1 MB |
| **首次使用合计** | **约 168 MB（WASM）/ 约 231 MB（WebGPU）** |

权重来自 Hugging Face，不存放在 Git 仓库；本次测试下载到了本机 `node_modules` 的 Transformers 缓存，测试后已清理。中国网络无法访问 Hugging Face 时，本地模型会失败并回退讯飞/浏览器语音。WebGPU 路径会优先选择 q4f16，因此首次下载可能比 WASM 的 q8 更大。

## 结论

- **实现是真的**：Moonshine 能识别，Kokoro 能合成，链路和回退代码不是占位。
- **干净合成音上效果不错**：Moonshine 0% WER，Kokoro 可懂度 100%；但样本只有 6 条，不能证明真实学习者场景。
- **浏览器实际表现仍未知**：本次是 Node 原生 CPU，浏览器 WASM/WebGPU 会更慢或更不稳定；仍需真实设备验收。
- **不能替代 DeepSeek**：Moonshine 替代的是讯飞 ASR，Kokoro 替代的是设备/讯飞 TTS；对话、纠错、评分仍由 DeepSeek 完成。
- **当前只适合实验功能**：首次约 168MB 下载、Hugging Face 依赖、低端设备性能闸门，都不适合作为默认卖点。
