# apps/storybook — 文档站

OpenAgentPack Kit 的官方文档站与组件展示站，使用 Next.js + Fumadocs 构建为纯静态产物。
内容以中文为主，代码标识符和上游原文保持原语言。

本文件面向人类读者；MDX 约定、主题、预览与生成链路见 [AGENTS.md](./AGENTS.md)。

## 站点内容

- **落地页**：项目定位、能力概览、组件与设备预览。
- **文档**：快速开始、本地 Demo、核心概念、SDK 接入、组件、Skill 与部署。
- **接口参考**：从 `apps/server/openapi.json` 生成的 `/docs/api/**` 页面。
- **组件预览**：`/previews/*` 直接渲染真实的 `@openagentpack/kit-chat-ui`，不是截图。
- **Skill 文档**：英文 Skill 入口、安装说明、生成参考与可编译示例。
- **静态搜索**：构建时生成搜索索引，部署后无需搜索服务。

## 快速开始

```bash
pnpm install
pnpm dev storybook             # http://localhost:3000
```

或启动完整环境：

```bash
pnpm dev                  # server + web + console + storybook
```

单独构建并静态托管：

```bash
pnpm --filter storybook build
python3 -m http.server 3010 --bind 127.0.0.1 --directory apps/storybook/out
```

`predev` 会先同步 `apps/server/openapi.json` 并打包 Skill 下载资产；`prebuild` 还会
先构建 chat-ui 依赖，因此不要求手工按顺序执行这些步骤。

## 修改内容

- **新增文档**：在 `content/docs/` 添加 `.mdx`，再到 `content/docs/meta.json` 登记顺序。
- **修改接口**：先 `pnpm gen:openapi` 更新 server 的 OpenAPI，再构建文档站；不要手改
  生成的 `openapi.json` 或 `/docs/api/**` 页面。
- **修改 Skill 示例**：先改 `scripts/skills/src/*/examples/`，再运行 `pnpm gen:skills`；
  `pnpm check:skills` 只检查漂移，不会自动修正。
- **新增组件预览**：在 `components/showcase.tsx` 注册名称，并在 `components/demos/` 添加
  纯客户端 demo。

## 代码结构

```text
app/                 首页、文档页、组件预览、静态搜索路由
content/docs/        中文文档与 meta.json 导航
components/          站点 UI、预览壳、落地页动效与 MDX 展示组件
lib/                 source / MDX / OpenAPI 装配
scripts/             OpenAPI 同步与搜索索引复制
e2e/                 静态站上的组件交互回归
public/              静态资源与构建时复制的 Skill 下载资产
```

## 验证

```bash
pnpm --filter storybook typecheck
pnpm --filter storybook test
pnpm --filter storybook build
pnpm --filter storybook e2e   # 需先静态托管 apps/storybook/out，或设置 DOCS_PREVIEW_URL
pnpm check:docs
pnpm check:skills
```

## 相关文档

- [文档站不变量](./AGENTS.md)
- [架构与依赖方向](../../docs/architecture.md)
- [接口与 op 对照表](../../docs/interfaces.md)
- [贡献指南](../../AGENTS.md)
