# Inspire SpeakEasy 完整系列题库实施

**Goal:** 将用户指定播放列表的完整 Interview 系列作为练习与模拟的主要共用题库，不再仅收录 #190。
**Source:** https://www.youtube.com/playlist?list=PLfNWEZJODl5iNLcLDJX27jebB_psDCPec
**Verified inventory:** 2026-10-28 通过公开列表滚动读取 190 个不重复视频，覆盖 #1–#190。
**Architecture:** 根据公开字幕或原视频音轨核实后，按每期四题改编并冻结为版本化 JSON；来源及视频链接逐组保留。后端池筛选与前端可搜索分页共用同一份目录。现有 ETS 5 组作为可选补充。

## Interfaces
- Final data: backend/app/data/inspire_interviews.json，顶层对象 {"playlist_url": string, "reviewed_at": "2026-10-28", "sets": [ ... ]}。
- 每组字段：id、episode、topic、topic_en、intro、questions[4]、hints[4]、source_title、source_url、source_kind="video_adapted"、reviewed_at。
- #190 保留 id=inspire-writing-190；其他 id=inspire-<episode>。文字是题意改编，不复制范文，不冒称考场真题。
- GET /api/interview/sets 兼容旧 sets，新增每组 collection（inspire/ets）与 episode。
- GET /api/interview/questions 新增 source=inspire|ets|all，默认 inspire；指定 set_id 的旧调用继续支持。随机选择完整四题组，不跨视频拼题。
- frontend getInterviewSet(setId?, signal?, source="inspire")；useInterviewSession.begin(mode,setId?,source="inspire")。
- 前端默认博主系列，来源切换、中文/英文主题与 #期数搜索、每页 6 组及分页；随机按钮只从当前来源抽取，练习/模拟共用来源参数。

## Tasks
- [x] 读取并核对完整视频目录、公开字幕及无字幕期的原音轨；记录每期来源及缺失情况，不以占位或编造补齐。
- [x] 按原题意逐期改编四题、中文提示及主题，检查去重、四题完整性和覆盖数。
- [x] 后端加载、来源过滤、兼容协议和失败输入测试。
- [x] 前端搜索、分页、来源筛选及两个模式共用抽题池；防止切换过滤时保留不可见旧选择。
- [x] 全套测试、iPhone 11/桌面功能验收、独立审查、EthanLyu30 署名提交、主线推送与上线核实。
- [x] 清理原始字幕、采集缓存及本轮辅助文件，只保留最终题库、维护代码与验收文档。

## Review Focus
- 实际覆盖数量必须来自已核实数据，不能把目录数量当作已导入数量。
- 不改变已有四题练习、模拟计时、重试、保存与历史回顾。
- 题库页不暴露模拟未来题，搜索结果为空有明确恢复入口。
- 用户未提交的部署/运维文件保持原样。

## Content Verification
- 先核对完整播放列表与频道身份，再将每一期的四题与源字幕或音轨转写逐一核对。
- 无英文字幕的期数使用原视频音轨识别；只取前四道访谈题，剔除考试说明、答题静音及后面的参考答案。
- `source_method` 记录 public_captions / audio_asr；`question_timestamps` 记录核对用的源分段起点。音轨首段可能包含开场说明，该时间不冒称精确到提问首词。
- 改编不要求凑词数，不增加原题没有的时间、地点、比较选项或第二个独立任务。独立内容审查后修正范围偏移，并同步中文提示。
- 题库为版本化快照；未来扩充需同时核对新视频来源、四题及目录覆盖测试。

## Final Acceptance
- 已核实 #1–#190，全190组760题；141组公开字幕、49组原音轨，另保留ETS5组20题。
- 后端283项、前端133项测试通过，lint/类型检查/生产构建通过。正式站两个来源的两种模式和10档布局验收通过。
- 后端142dc20、前端bb23846均由EthanLyu30提交，已推送main，Render/Vercel及CI成功。
- 工作区与测试夹具已回收；系统临时目录剩一个被自动审批禁止删除的空pytest-current链接，详见[验收记录](../../interview-series-qa-20261028.md)。
