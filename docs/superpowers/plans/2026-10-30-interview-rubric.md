# Interview 评分标准实施计划

> **For agentic workers:** Use superpowers:executing-plans inline, task by task. 用户已经要求实施，无需再次选择执行方式。

**Goal:** 新Interview单题0–5内容参考评分有明确分档，并验证区分度、重复稳定性和旧功能兼容。

**Architecture:** 评分规则独立模块负责分档与非回答兜底；评分API保持单次模型调用并返回分制版本。沿用detail JSON保存元数据，历史按原分制展示，均分不混合两套标准。

**Tech Stack:** Python/FastAPI/Pydantic/pytest；React/TypeScript/Vitest；现有DeepSeek Flash。

**Spec:** `docs/superpowers/specs/2026-10-30-interview-rubric-design.md`

## Global Constraints

- 每题0–5整数、只评文本，均分由后端计算；不得声称预测官方1–6科目分。
- 保留四题统一评分、重试/保存、两版参考表达与来源、75词上限、55秒总预算；不增加常规评分次数。
- 旧记录保留0–6，跟读0–100；用户已有部署文件不纳入提交。

## Review Focus

- 模型返回6、浮点、布尔分数时不能悄悄接受或截断。
- 低分/空回答仍有完整范文，压缩不能篡改评分。
- 没有元数据或损坏detail的历史不能当作新版。
- 新旧历史混合时，均分不能直接相加或把旧分伪装成新分。
- 校准不可把模型自己的分数当真值；异常/超时和不达标必须退出失败。

## Task 1: 后端分档、校验与元数据

完成：RED11项缺失功能后GREEN；最终全量后端357项通过。

- [x] 在`backend/tests/test_interview_rubric.py`先写失败测试：0–5严格整数、非回答兜底、服务端等级/均分/元数据、提示词六档与无声音边界、温度、范文保持。
- [x] 运行定向pytest确认RED。
- [x] 新增`backend/app/data/interview_rubric.py`，修改`app/api/interview.py`、`schemas/interview.py`；更新原有6分测试为新标准。
- [x] 定向pytest确认GREEN。

## Task 2: 保存、历史与前端分制

完成：历史7项RED后GREEN；结果、进度和个人页均保留原分制，前端最终177项通过。审查发现的个人页固定/6已先复现再修复。

- [x] 在`backend/tests/test_practice.py`及前端结果/进度测试中补RED：新版/旧版/无效detail、分制展示与均分隔离、评分说明、元数据保存。
- [x] 修改PracticeRecord的只读分制属性及响应schema；前端API类型、结果页、准备页、进度页和评分说明同步更新。
- [x] 定向pytest/Vitest确认GREEN，保持视频切换、朗读、四题才评分测试。

## Task 3: 固定样本校准与全量回归

完成实现与验收：18×3最终校准命中94.4%，8×3独立验证命中100%，最大跨度0/1；已保存`docs/interview-rubric-qa-20261030.md`。发布与清理另按Git及云端回执核验。

- [x] 固定`backend/tests/fixtures/interview_scoring_calibration.json`的分档和区间；添加可复跑`backend/scripts/calibrate_interview.py`及报告汇总逻辑测试。
- [x] 使用现有本地DeepSeek配置运行至少3轮，核对区间命中、排序、跨度和语义边界；记录实际结果和局限。
- [x] 全量后端pytest、前端test/lint/typecheck/build，审阅diff与历史兼容。
- [x] 更新验收报告；按用户既有授权提交、合并main并push，核对部署，清理本任务临时目录；主检出受应用保护而暂留，见验收报告。
