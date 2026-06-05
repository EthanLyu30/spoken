# Spoken · Frontend (React + TypeScript + Vite)

口语陪练的 Web 前端：场景选择、实时语音对话与课后反馈。

## 设计系统

视觉方案为 **「Signal — The Language Journal」**（语言学习日志 / 编辑杂志风）：

- 暖纸背景 `#F4EFE6` · 牛血红主色 `#6E1A1F` · 信号橙高亮 `#FF5A1F`
- 双衬线排版：Fraunces（标题）+ Newsreader（正文）+ Space Grotesk（元信息）
- 拉丁字体经 `@fontsource` 随应用打包（国内无需依赖外部 CDN）；中文走系统字体兜底
- 设计理念：对话时收敛为安静的「阅读室」、只有麦克风发光；报告页展开杂志式的量化反馈

所有色彩令牌由 `src/index.css` 的 CSS 变量统一驱动，`tailwind.config.js` 映射为 Tailwind 颜色。

## 环境要求

- Node.js 18+（开发使用 Node 24）

## 本地运行

```bash
cd frontend
npm install
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
│   ├── index.css           # 设计令牌 + 全局样式 + 编辑风工具类
│   ├── pages/              # Home / Conversation / Report
│   ├── components/         # Masthead / ScenarioCard / BackendStatus / ui
│   ├── data/               # 场景样例数据（后续由后端提供）
│   └── lib/                # api 客户端、设计令牌、工具函数、图标
├── tailwind.config.js
└── vite.config.ts
```

> 实时语音、发音评测与报告等功能随后续 PR 加入，详见根目录 `docs/ROADMAP.md`。
