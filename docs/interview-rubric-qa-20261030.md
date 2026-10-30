# Interview 0–5评分验收与校准（2026-10-30）

依据：[ETS Take an Interview单题评分标准](https://www.ets.org/content/dam/ets-org/pdfs/toefl/speaking-rubrics.pdf)。本次只实现可从转写文本观察的内容、语言和组织标准，不评声音表现，不换算为官方1–6科目成绩。

## 实现与兼容

- 新评分为0–5严格整数，六档规则同时写入提示词与结果页折叠说明。反馈需联系学习者原话，给一个45秒内可实施的改进；视频立场和固定词数不是评分标准。
- 后端拥有分制版本、等级与平均分；空白/明确未作答/无英语有0分兜底。模型返回6、布尔或非整数时拒绝该结果，沿用评分重试流程。
- 仍是四题答完才评分；范文和评分共用原有调用，压缩只改范文，保持75词上限和55秒总预算。
- 元数据沿用detail JSON保存，无数据库迁移。旧记录保留原0–6，跟读仍0–100；进度均分不混入旧分，个人页按5分/6分分别画图。

## 真实模型结果

模型配置为项目现有deepseek-flash，评分温度0。夹具均为人工编写的虚构回答，预设区间在执行前固定，不是ETS标注，也不是独立考官验证；下列命中率不能当作真实考试评分准确率。

初轮18份×3次：区间命中92.6%，最大跨度1分。随后只细化1/2与2/3边界，未修改这18份答案或预设区间。最终复测及独立新题组如下：

| 组别 | 答案数×轮数 | 预设区间命中 | 最大重复跨度 | 模型调用 | 总耗时 |
|---|---:|---:|---:|---:|---:|
| 最终校准 | 18×3 | 94.4% | 0 | 15 | 43.7秒 |
| 未参与提示词修改的验证组 | 8×3 | 100.0% | 1 | 6 | 17.26秒 |

两组的分档均值均无倒置，所有预设0分样本都为0。最终校准的18份答案三轮完全一致；独立验证组的短而完整回答为4/4/5，其余完全一致。最长跨度1分符合预先门槛。

**保留的偏差：**technology-2预设2分，三轮均为1分；模型认为只有phone/problem等片段，不能还原具体事件。该边界判断存在主观性，未调低夹具区间掩盖它。其余51/54次校准命中。后续仍需要更大样本及独立教师标注。

### 逐样本记录

| 样本 | 预设区间 | 三轮得分 |
|---|---:|---|
| study-0 | 0–0 | 0 / 0 / 0 |
| study-1 | 1–1 | 1 / 1 / 1 |
| study-2 | 2–2 | 2 / 2 / 2 |
| study-3 | 3–3 | 3 / 3 / 3 |
| study-4 | 4–5 | 4 / 4 / 4 |
| study-5 | 5–5 | 5 / 5 / 5 |
| technology-0 | 0–0 | 0 / 0 / 0 |
| technology-1 | 1–1 | 1 / 1 / 1 |
| technology-2 | 2–2 | 1 / 1 / 1 |
| technology-3 | 3–3 | 3 / 3 / 3 |
| technology-4 | 4–5 | 4 / 4 / 4 |
| technology-5 | 5–5 | 5 / 5 / 5 |
| opposite-position | 4–5 | 5 / 5 / 5 |
| fluent-off-topic | 0–0 | 0 / 0 / 0 |
| no-english | 0–0 | 0 / 0 / 0 |
| injection-off-topic | 0–0 | 0 / 0 / 0 |
| short-complete | 4–5 | 5 / 5 / 5 |
| missing-question-branch | 2–3 | 2 / 2 / 2 |
| validation-0 | 0–0 | 0 / 0 / 0 |
| validation-1 | 1–1 | 1 / 1 / 1 |
| validation-2 | 1–2 | 2 / 2 / 2 |
| validation-3 | 3–3 | 3 / 3 / 3 |
| validation-4 | 4–5 | 4 / 4 / 4 |
| validation-5 | 5–5 | 5 / 5 / 5 |
| validation-short | 4–5 | 4 / 4 / 5 |
| validation-off-topic | 0–0 | 0 / 0 / 0 |

### 来源题组回归

本地使用真实DeepSeek跑#190原题组四题，均分4.0/5，逐题4/4/4/4；升级版58/56/57/57词。原回答保持，四题都保留视频来源，第2题仍定位265秒。只检查返回数据与元数据，未冒充线上网页/真实音频验收，未写练习记录。

最终校准54条点评没有发音、语速、停顿、语调或流利度判断；范文40–67词。

## 回归与审查

- 基线后端329、前端169项通过。新增规则RED阶段11项失败后修复；历史元数据RED7项失败后修复；前端新分制/旧记录和混合历史测试先失败后通过。
- 最终后端357项、前端41文件177项全部通过；lint、TypeScript与生产构建通过。68条后端警告来自原有依赖/UTC弃用及新增测试触发的同类警告。
- 独立审查发现个人页仍固定/6；补充回归先复现失败，再将新旧记录拆为原生5分/6分图，测试通过。未发现其他确认的合并阻碍。
- 四题前不评分、识别/评分重试、保存与历史、来源链接、视频版本切换、升级版和TTS仍由现有及新增回归覆盖。

## 复跑

在backend目录使用现有虚拟环境，执行以下命令；仅真实校准会调用DeepSeek，不访问生产评分路由或数据库。不要提交.env或密钥。

```powershell
python -m pytest -q
python scripts/calibrate_interview.py --env-file .env --output calibration.json
python scripts/calibrate_interview.py --env-file .env --fixtures tests/fixtures/interview_scoring_validation.json --output validation.json
```

校准失败会退出非0；门槛为结构/0分边界完整、区间命中至少90%、同答案跨度不超过1、分档均值不倒置。校准默认三轮，不在普通pytest或生产请求中额外运行。

测试夹具原始字节SHA256：
- calibration: 9f2649a6c6131399af5a535feb365a2916f3762f7aa76ae8641833a5f7030a70
- validation: f351e623fbdb72d11ed93e96190962d78118a58c836c023c6c222c2ee10fc10a

## 验收边界

本报告确认本地真实评分、固定样本稳定性、接口及组件回归。没有声称与官方考官等价，没有真实麦克风/听感或线上四题完整点击流程的新增证据；先前生产评分执行拒绝与浏览器控制限制没有被本次改动解除。

交付仅保留源码、可复跑测试/夹具/校准脚本及本文档。原始模型输出、专属辅助脚本、构建与隔离工作目录在交付核验后清理。

## 发布与清理回执

- 功能提交`f787b0d`与历史修复/校准报告提交`f025d48`已合并、推送main，作者EthanLyu30。[CI前后端检查成功](https://github.com/EthanLyu30/spoken/actions/runs/41055632630)，[Vercel生产部署成功](https://vercel.com/ethanlyu30s-projects/spoken/55sMHLUbQDL3Ucf1SP7VSNzxqHsm)。
- 正式站/interview返回200，实际入口`index-D197QP5t.js`加载`InterviewResults-zwDHZyka.js`，含0–5评分说明、旧版标记、视频原版及DeepSeek升级版。后端/openapi.json实际返回单题maximum=5、overall maximum=5、score_max default=5。这些是版本发布证据，不代替一次线上实际评分请求。
- 6个专属模型原始输出/辅助文件、2个构建/依赖目录及9个Python缓存目录已精确核对路径后回收。原工作区9个用户部署/运维文件SHA256逐一未变，未纳入提交；任务分支已删除。
- 隔离检出`C:\Users\Administrator\.codex\worktrees\interview-rubric\spoken`被应用标记为本任务主检出，原生archive_worktree拒绝移除；原工作区D:\personal_space\spoken并非托管worktree，不能通过attach切回。没有强制删除主检出或绕过此保护，暂留其已提交源码（detached HEAD）；可清理的临时输出均已回收。
