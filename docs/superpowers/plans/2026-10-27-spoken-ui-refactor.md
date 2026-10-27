# Spoken UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户确认的全站设计落地到真实产品，保留全部现有功能和数据。

**Architecture:** 继续使用 React Router、Zustand 和现有 API 客户端，增加共享桌面导航和场景容器。逐模块调整展示结构，不把设计预览脚本或 mock 数据引入生产。

**Tech Stack:** React 18 / TypeScript / Vite / Tailwind / Zustand / Lucide / ECharts / Vitest。

**Spec:** `docs/UI_REFACTOR.md`；视觉基准 `design/spoken-ui-2026-10-27/`。

## Global Constraints

- 桌面主视口 1440×900，900px 以下窄屏，所有原有路由继续可用。
- 珊瑚红 `#ff6251`、纸色 `#fffcf7`、正文 `#342019`、线色 `#eadfd4`；视觉变化不得隐藏功能。
- Take an Interview 为4题、每题45秒；/6为基于转写内容的练习参考分。
- 不改 API、存储键、clientId、JWT、practiceId 和语音状态机；不使用生产 mock。
- 用户已确认设计并授权按文档继续分模块实施，不增加逐模块审批。
- 当前在 `codex/fix-availability` 功能分支；按文件限定提交，保留用户已有部署相关改动。

## Review Focus

- 原型未展示的场景仍有入口，五个主题和其余目录项不漏关。
- 后端离线或失败时推荐/统计/历史不会伪造成功或卡死，旧推荐仍能启动。
- 通话/录音/识别/流式响应中的禁用和清理语义不因组件布局改动丢失。
- 游客/账号切换后的词库和个人数据不串用；语音设置保留历史值。
- 窄屏、长英文、长列表、弹层和打印不会遮住主要操作或截断内容。

## Task 1: 视觉基础、导航与状态

**Files:** Create `frontend/src/components/AppHeader.tsx`, `AppHeader.test.tsx`; Modify `App.tsx`, `BottomNav.tsx`, `Wordmark.tsx`, `Buddy.tsx`, `index.css`, `lib/tokens.ts`, `tailwind.config.js`。

**Interfaces:** AppHeader 无参数；App 按路由显示主导航，对话使用专注导航。原有页面业务 props 和 store 接口保持不变。

- [ ] 导航行为测试先行：学习工具可展开、选择生词本/金句可导航，Escape 关闭，场景和访谈链接可达。
- [ ] 运行 `npm test -- src/components/AppHeader.test.tsx`，确认新增导航测试先失败。
- [ ] 实现导航和令牌；加载路由时显示有名称的状态；重用确认的插画资产。
- [ ] 运行目标测试、typecheck；在浏览器核验桌面导航与390px底栏。
- [ ] 提交 `feat(ui): establish desktop shell and visual foundation`。

## Task 2: 首页、场景地图与自定义

**Files:** Create `pages/Scenes.tsx`, `components/SceneTabs.tsx`, `components/DailyGoal.tsx`, `pages/Scenes.test.tsx`; Modify `Home.tsx`, `CustomScene.tsx`, `DailyScenePick.tsx`, `JourneyPath.tsx`, `App.tsx`。

**Interfaces:** `/scenes` 为地图，`/custom` 为生成；SceneTabs 无参数。JourneyPath 仍接收 `Scenario[]`。DailyGoal 使用 `getStats(signal?)`；DailyScenePick 沿用推荐 API 和 custom store。

- [ ] 测试每个主题下真实场景链接、自定义入口、未分组场景可达；测试推荐刷新传 fresh=true且能启动返回场景。
- [ ] 运行目标测试，先确认新入口/错误重试行为失败。
- [ ] 从首页迁移地图，重建首页三段布局，接入真实目标和现有金句；保留推荐缓存和快捷入口。
- [ ] 自定义保留示例直达、快捷键、忙碌、错误重试；首页/地图/自定义在1440和390视口核验。
- [ ] 提交 `feat(ui): rebuild home and scene practice hub`。

## Task 3: 对话工作区和学习弹层

**Files:** Modify `pages/Conversation.tsx`, `components/ChatBubble.tsx`, `TurnCorrectionCard.tsx`, `PronunciationFeedback.tsx`, `PronounceButton.tsx`, `dictionary/DictionaryOverlay.tsx`, `index.css`；extend `Conversation.test.tsx` only when behavior changes。

**Interfaces:** 所有音频、流式回复、handler和现有props保留；增加场景侧栏展示已有场景信息，返回 `/scenes`，设置入口 `/me?tab=voice`。

- [ ] 运行现有 Conversation、ChatBubble、TurnCorrectionCard、Dictionary、speech/call 相关测试作为保留契约。
- [ ] 调整为桌面左右布局、专注导航和固定底部输入；窄屏回到单列，保留错误/字幕/提示。
- [ ] 任何新增交互先写失败测试；样式变化用浏览器视觉验证。
- [ ] 运行整个前端测试与typecheck；浏览器验证文字切换、点词、提示、设置、错误重试入口。
- [ ] 提交 `feat(ui): restyle conversation and learning overlays`。

## Task 4: Take an Interview、课后小结与历史

**Files:** Modify `Interview.tsx`, `Report.tsx`, `SessionView.tsx`, `Progress.tsx`, `index.css`；Create `Interview.test.tsx` if adding question selection。

**Interfaces:** 访谈生成/录制/评分接口不变；新增结果选题只切换展示，不重置答案。Report 保留幂等保存与重试。Progress 保留可选洞察/雷达与历史。

- [ ] 测试结果逐题切换展示匹配的问题和回答；原录音和提交链路不变。
- [ ] 先运行新增测试失败，再实现访谈准备/答题/结果布局。
- [ ] 调整小结和历史布局，保留所有报告区块、表达收藏和打印；进度增加真实统计概览。
- [ ] 运行目标测试与全套测试；浏览器检查无记录、失败和真实历史入口。
- [ ] 提交 `feat(ui): redesign interview reports and progress`。

## Task 5: 学习工具、个人中心和账号

**Files:** Modify `WordBag.tsx`, `Daily.tsx`, `Profile.tsx`, `ProfileHero.tsx`, `AuthModal.tsx`, `Onboarding.tsx`, `index.css`；Create `WordBag.test.tsx`, `Profile.test.tsx` for changed behavior。

**Interfaces:** `/me?tab=voice` 展示现有语音设置；`/me` 保留资料/挑战/徽章/历史，锚点支持成就和记录。WordBag 原word store接口不变。

- [ ] 测试首次空词库可以添加、word/sentence分组和复习翻面评分；测试个人中心可进入设置并保留三种引擎。
- [ ] 运行目标测试确认新入口先失败。
- [ ] 按设计调整词库和金句列表，保留原搜索/朗读/跟读/AI生成/收藏；个人中心拆展示布局，保留12徽章和图表。
- [ ] 更新账号与四步引导；统一Take an Interview文案，保留邮箱密码和游客绑定逻辑。
- [ ] 运行测试、typecheck、lint、build；浏览器核验工具和游客入口。
- [ ] 提交 `feat(ui): unify learning tools and account experience`。

## Task 6: 全站验收与清理

**Files:** Create `design-qa.md`；更新本计划完成状态与 `docs/UI_REFACTOR.md` 的验收记录。

**Interfaces:** 用现有自动化测试加真实浏览器共同验证；不得用构建成功替代视觉和交互验收。

- [ ] 逐行复核功能矩阵与代码入口，处理遗漏；运行 `npm test`、`npm run typecheck`、`npm run lint`、`npm run build`。
- [ ] 使用CUA在1440×900、1280和390×844检查主要页面、菜单、长内容、弹层和空/错状态；保存最终截图并与批准稿合并对照。
- [ ] 一次独立全改动审查，处理重要问题、追加针对性回归测试，记录无法进行真实AI/麦克风验证的边界。
- [ ] 提交通过的代码和验收记录；仅清理本任务创建的中间脚本/日志/失败截图，保留用户输入、设计稿、文档和最终预览。
- [ ] 向用户交付本地预览、文档链接、提交和验证结果；不推送或部署。

## Execution record

- 2026-10-27：设计已确认；先完成代码与功能盘点，保留全部现有路由/数据链路。实施尚未开始。
