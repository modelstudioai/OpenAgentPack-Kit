# apps/storybook — Fumadocs 文档站（静态导出部署）

## 不变量

1. **内容与仓库事实一致**：命令、op、包名改动时同步本页；`pnpm check:docs` 会校验 `.md` / `.mdx` 中
   `pnpm <script>` 真实存在，活跃文档不引用已移除的独立 CLI。
2. **中文为主**（开源前），英文版在开源迁移时补；代码标识符保留原文。
   Skill 是例外：`scripts/skills/src/` 的入口、参考、元数据与示例全部使用英文，
   站内 Skill 介绍、安装说明与导航仍为中文，嵌入示例保持英文原文。
3. **不引入内网域名/包**（零内网依赖约束同样适用）；也不引外部字体/CDN——静态产物必须离线可开。
4. fumadocs-mdx 16 的加载链路：`source.config.ts` → `.source/server.ts`（生成物，不手改）→
   `lib/source.ts` 的 `loader()` → 页面用 `source.getPage/pageTree/generateParams`。
5. **MDX 自定义组件走 `lib/mdx-components.tsx`**：fumadocs-mdx 15 不读 Next 的
   `mdx-components.tsx` 约定文件，必须在渲染处显式传 `<MDX components={mdxComponents} />`
   （`app/docs/[[...slug]]/page.tsx`）。新增可在 MDX 里用的组件时改这一处。
6. **组件预览渲染的是真实 `@openagentpack/kit-chat-ui`**（storybook 直接依赖 workspace 包），
   不是截图或复刻。因此 `app/globals.css` 必须保留两条东西：
   `@import "@openagentpack/kit-chat-ui/theme.css"`（token）与
   `@source "../../../packages/chat-ui/src/**/*.{ts,tsx}"`（Tailwind 扫描，缺了会静默无样式）。
   手机设备预览走 `components/phone-frame.tsx` 的仿真壳（中框/侧键/灵动岛/状态栏/Home 条/眩光），
   装饰层一律 `aria-hidden` + `pointer-events: none`；状态栏颜色吃 chat-ui 的 `--kit-fg`，
   随 `data-kit-theme` 自适应。内容通过 `/previews/[name]/` 静态 iframe 路由运行，
   media query 与 `useIsMobile` 使用预览自己的视口；手机使用真实窄屏宽度，切换设备不重挂 iframe。
   `lib/showcase-names.ts` 同时约束静态路由与注册表。主题由父页面同步，预览不得改写父页面的主题存储。
   桌面预览使用 `--kd-preview-desktop-width` 定义的独立视口并按可用空间缩放，不能因文档栏变窄切到移动布局。
   依赖浏览器宽度决定首屏结构的 Layout 演示通过客户端 `next/dynamic` 关闭 SSR，避免窄屏 hydration 不一致。
   改壳不要动预览交互层。
7. **接口声明页是生成物**：`scripts/sync-openapi.mjs`（predev 与 prebuild 的第一步）把
   `apps/server/openapi.json` 复制到本包根目录（gitignore），`lib/openapi.ts` 用
   fumadocs-openapi 按 tag 生成虚拟页面（`/docs/api/**`）。改路由后先 `pnpm gen:openapi`
   再构建文档站；不要手改 `openapi.json` 或虚拟页面。
8. **import 一律相对路径 + 显式扩展名**（`../../lib/source.ts`），不用 Next 的 `@/` 别名：
   dependency-cruiser 不解析该别名，用了会把文件判成 orphan（门禁报 warning）。
9. **静态导出约束**：`output: "export"` + `trailingSlash`；不用 server actions、不用
   `redirect()`（首页与落地页都是纯静态）；交互一律放 `"use client"` 组件。
   `public/skills/` 是构建复制的下载资产，不进入 storybook 的 TypeScript 和架构扫描；
   其中示例的唯一检查源在 `scripts/skills/src/*/examples/`。
10. **Skill API 与示例只有一份源文件**：`pnpm gen:skills` 从公开 TypeScript API 更新英文参考，
    并同步组件、SDK 与 Skill 栏目 MDX 中 `{/* skill-example: <skill>/examples/<file> */}` 标记之间的代码。
    不手改生成区；先改 Skill 的 TS/TSX 示例，再生成。`pnpm check:skills` 只检查漂移，
    文档构建不能自动修正已跟踪文件。静态下载由构建准备到 `public/skills/`，不入库。
11. **SDK 栏目按四层说明接入**：Stream、Request、Provider、Chat 分别说明读取、HTTP、
    后端映射与会话编排。Controller 从 `kit-sdk/chat` 导入，hooks 从对应功能的 `/hooks` 导入；
    KitClient 来自 `kit-sdk/providers/kit`；KitProvider 与 Context 来自 `kit-sdk/providers/kit/react`，
    `useIsMobile` 来自 `kit-sdk/hooks`。源码与公开入口按 ADR-0026 的功能模块对应，
    不使用旧根入口或 `/react`，内部生命周期与 Client 解析工具不列入公开 API。
    不把通用 SSE EOF、HTTP 成功或单条消息完成描述为 Agent 执行完成。
12. **站点视觉层只在 `app/globals.css`**：自有 token 一律 `--kd-*`（圆角/阴影/动效/表面/强调色），
    亮暗两套各自校对比度；`--kit-*` 是 kit-chat-ui 的冻结 token，站点**不得重名定义**
    （预览外框只读 `var(--kit-bg)` 等做兜底，暗色跟随靠给外框加 `data-kit-theme="dark"`）。
    站点组件里禁止写裸颜色/圆角/阴影常量。
13. **图标一律 `components/icons.tsx` 的内联 SVG**（同族：24 viewBox、1.75 描边、圆头、currentColor）；
    禁止 emoji 与 ☀/☾ 之类字符图标；装饰性图标 `aria-hidden`，图标按钮必须有 `aria-label`。
14. **壳文案中文化集中在 `lib/i18n.ts`**（fumadocs 的翻译键即英文原文），经 RootProvider
    `i18n.translations` 注入；新增壳文案先查 `node_modules/fumadocs-ui/dist/.translations/keys.js`。
15. **搜索是静态索引**：`app/api/search/route.ts` 的 `staticGET`（`output: export` 下预渲染成
    `out/api/search`）+ RootProvider `search.options.type = "static"`。删掉任一处，搜索框就永远是
    空结果（部署站实测过 `data-empty=true`）。
    `components/site-provider.tsx` 仅在 `/previews/**` 禁用搜索，防止 iframe 内的搜索快捷键触发站点导航；
    站点的按钮和快捷键搜索仍须可用。
16. **落地页结构组件**在 `components/{site-header,terminal-card,reveal}.tsx`；进场动效（`.kit-reveal`）
    只动 opacity/transform，`prefers-reduced-motion` 下直达终态；侧栏目录名中文化在 `lib/source.ts`
    的 `FOLDER_TITLES`（只改展示名，不改 URL）。
17. **reactbits 式展示层**：签名动效 =
    极光光带 / 点阵底 / 跑马灯 / spotlight 卡 / scramble-decode 标题 / 数字滚动，实现集中在
    `components/{marquee,glow-card,scramble-text,count-up,hero-showcase}.tsx` 与 `globals.css` 的
    keyframes；**全部手写 CSS/原生 JS，不引动效依赖**。每条动效必须回答「reduced-motion 下是什么」：
    一律静止/终态；scramble 与 count-up 的 SSG 首屏直接输出最终文本（无 JS 也可读）。
    hero 背景是 **ColorBends 同概念自研 shader**（`components/backgrounds/color-bends.tsx`，
    vanilla WebGL、零依赖、变体 nebula/aurora/ember/ice 只换颜色 uniform）；WebGL 不可用时
    渲染 null 回落 CSS 极光（hero 无 `data-webgl` 属性时 `::after` 仍在）；离屏/hidden 暂停 rAF，
    reduced-motion 只画一帧。光带必须压在下半屏（frag 里 ribbon base ≤ 0.40），文案区对比度优先。
18. **主题按路由固定**：首页暗、`/docs/**` 亮。`app/layout.tsx` 的内联脚本在绘制前按 pathname
    写 class 与 next-themes 的 storageKey（防闪白/闪黑）；`components/route-theme.tsx` 负责 SPA
    跳转时同步。**不要再加手动主题开关**（落地页 ThemeToggle 已删、docs 侧
    `themeSwitch={{ enabled: false }}`）——手动切换会与路由语义打架。预览的 `data-kit-theme`
    跟随 resolvedTheme，两套主题下都验过。

## 加一篇文档时

1. `content/docs/<slug>.mdx` + frontmatter（title/description）；
2. `content/docs/meta.json` 的 pages 登记顺序（文件夹用目录 + 自己的 meta.json）；
3. 需要组件预览时用 `<Showcase name="…" />`（注册表在 `components/showcase.tsx`，
   demo 在 `components/demos/`，纯客户端、无 server 依赖）。

## 强制它的闸门

- `pnpm --filter storybook build`（SSG 全页预渲染，编译即校验；60 页含 45 个接口页）。
  注意 `prebuild` 会先构建 kit-chat-ui/core/protocol：CI 只装并构建 storybook
  子树，不跑 turbo 全量 build，缺了这步 CI 会 `Module not found: @openagentpack/kit-chat-ui`；
- `pnpm check:docs`；
- `pnpm check:skills`（覆盖公开组件、API 漂移、独立目录链接与共享示例；已并入文档检查）；
- 浏览器回归：构建后用 `python3 -m http.server 3010 --bind 127.0.0.1 --directory apps/storybook/out`
  托管静态目录，再运行 `pnpm --filter storybook e2e`；可通过 `DOCS_PREVIEW_URL` 指定已有静态站点。
  用例放 `e2e/`，只验证组件本地交互，不连接 Kit server 或 Cloud。
- 视觉验收：静态托管后逐页看（亮/暗两套主题、预览的设备切换、
  390px 视口无横向溢出、搜索框有真实结果）。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
