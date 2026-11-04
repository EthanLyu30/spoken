# Interview 视频答案文字化

## 来源

- 公开播放列表：Inspire SpeakEasy Interview Practice
- 播放列表：https://www.youtube.com/playlist?list=PLfNWEZJODl5iNLcLDJX27jebB_psDCPec
- 题库：`backend/app/data/inspire_interviews.json`
- 已核对视频的答案页：`backend/app/data/inspire_answer_texts.json`

## 覆盖

- 190 组题中，174 组有已核对视频和答案页。
- 174 组 × 4 题 = **696 道题**。
- 696 道题共提取 **2,074 个参考答案选项**（多数题目 3 个，少量 2 个）。
- 其余 16 组没有公开答案页，继续使用原有 AI 口语示例。

## 方法

1. 按题库中的视频 URL 和答案页时间戳下载 720p 视频。
2. 在答案页时间戳后取帧，使用 Tesseract 5.4 OCR。
3. 解析每页的 `A1` / `A2` / `A3` 三段，做基础换行、空白和常见 OCR 修正。
4. 保存为纯文本；运行时只从自己的后端读取，不请求 YouTube，也不加载 iframe。

答案页来自公开视频中的文字画面。OCR 结果可能有少量识别误差，UI 标注为「参考答案 · 文字转录（OCR）」，只作为学习参考，不冒充逐字官方原文。

## 运行时

- 评分接口返回 `reference_answers`（每题最多三个文本选项）。
- 前端在结果页提供「回答 1 / 2 / 3」切换，可朗读当前选项。
- CSP 为 `frame-src 'none'`；Interview 页面和结果页不再包含 YouTube 链接或播放器。
- 中国大陆访问不需要打开 YouTube。
