# Spoken · Frontend (React + TypeScript + Vite)

口语陪练的 Web 前端：场景选择、实时语音对话与课后反馈。

## 新回复语音等待

默认由浏览器设备语音朗读，也可主动选择本地 Kokoro。`chat.first_text` 和 `chat.complete` 分别记录首段文本和全文完成。`speech.native_start` 记录原生启动，`speech.request_to_audio` 记录朗读提交至启动回调。实际出声需单独测量。

分段定义、受控回归和线上前后对比见 [新回复首声验收报告](../docs/performance/2026-11-01-fresh-reply-first-audio.md)。

## 设计系统

视觉方案为 **「Pip — 你的口语陪练伙伴」**（温暖圆润 / 角色陪伴 / 闯关成长）：

- 暖桃奶油背景 `#FFF3E6` · 珊瑚主色 `#FF6F5E` · 嫩芽绿 `#41C08C`，配一组糖果色点缀
- 圆润排版：**Fredoka**（标题）+ **Nunito**（正文），经 `@fontsource` 随应用打包（国内无需外部 CDN），中文走系统圆体兜底
- 原创角色 **Pip**（`components/Buddy.tsx`）：头顶嫩芽的珊瑚色小家伙，会眨眼、聆听（听你说话时泛起涟漪）、说话（嘴巴开合）、庆祝（撒星星）
- 首页提供每日推荐与目标。「场景练习」包含闯关地图与自定义场景。 [当前界面](../docs/screenshots/README.md)
- 柔软的黏土质感阴影 + 漂浮色块 + 颗粒噪点背景，整体大圆角、可挤压（按钮按下回弹）

所有色彩令牌由 `src/index.css` 的 CSS 变量统一驱动，`tailwind.config.js` 映射为 Tailwind 颜色；每个场景的糖果配色见 `src/lib/theme.ts`。

## 环境要求

- Node.js 20+（CI 使用 Node.js 20）

## 本地运行

```bash
cd frontend
npm ci
npm run dev
```

默认 <http://localhost:5173>。开发时 `/api` 与 WebSocket 请求经 Vite 代理转发到后端 `http://127.0.0.1:8000`（见 `vite.config.ts`），因此本地需同时启动后端。首页右下角会显示后端连接状态。

## 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器（HMR） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览生产构建产物 |
| `npm run typecheck` | 仅做 TypeScript 类型检查 |

## 目录结构

```
frontend/
├── src/
│   ├── main.tsx            # 入口（路由、字体、全局样式）
│   ├── App.tsx             # 路由表
│   ├── index.css           # 设计令牌 + 全局样式 + 角色动画关键帧
│   ├── pages/              # Home（今日推荐）/ Scenes（闯关地图）/ Conversation（对话）/ Report（小结）
│   ├── components/         # Buddy / BuddyHero / ScenarioCard / PlayfulBackground / ui
│   ├── data/               # 场景样例 + 学习进度样例（后续由后端提供）
│   └── lib/                # api 客户端、设计令牌、场景配色、工具函数、图标
├── tailwind.config.js
└── vite.config.ts
```

> 实时语音、发音评测与报告等功能随后续 PR 加入，详见根目录 `docs/ROADMAP.md`。
