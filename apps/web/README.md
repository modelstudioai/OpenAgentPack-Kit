# apps/web — 体验页

终端用户使用的纯静态 CSR 页面：成员登录后浏览 Agent 广场、创建会话、流式对话、处理工具
审批、查看文件产物与个人用量。

本文件面向人类读者；页面职责、断点与宿主能力约定见 [AGENTS.md](./AGENTS.md)。

## 主要功能

- **成员登录**：默认使用管理端创建的本地成员账号；登录、恢复与退出由 SDK 的 member-auth
  provider 管理。
- **广场与新建聊天**：按分类浏览已上架 Agent，查看用量与最近会话，进入聊天或新建会话。
- **对话**：SSE 流式消息、历史与实时归并、断线续传、停止执行、思考过程、工具审批、
  Artifact 预览与下载、附件上传与挂载、子 Agent 线程。
- **会话目录**：按 Agent 分组的会话侧栏，支持最近会话、重命名、归档、删除与分页加载。
- **用量**：每日/月度 Token、执行时长、月度限额与超限横幅；时间统一按北京时间展示。
- **响应式**：同一包覆盖桌面与 H5，窄屏通过抽屉提供导航和会话入口。

## 品牌配置

侧栏顶部的产品名和 Logo 由管理端「系统 → 配置」的品牌配置页维护，支持上传图片或填写 URL。
Web 启动时读取 `GET /api/config` 的 `branding` 字段，不再读取 `.env` 或构建时注入。

- `productName`：产品名称，未配置时使用 `OpenAgentPack Kit`
- `logoUrl`：可选 Logo；上传图片时指向 `/api/branding/logo?v=<hash>`，也可填写员工端本地路径
  （如 `/brand/kit-logo.svg`）或在线 `http(s)` URL

没有配置 Logo 时显示产品名首字母；Logo 加载失败也会回退到首字母标记。

## 快速开始

```bash
pnpm install
pnpm dev web              # http://localhost:5173
```

完整本地环境：

```bash
pnpm dev                  # server + web + console + storybook
```

首次使用需要在管理端（`http://localhost:5174`）创建成员，再用该账号登录体验页。
没有百炼凭据时设置 `KIT_GATEWAY=mock` 即可跑通对话链路。

只启动 web 时，server 需要已启动或通过 `?api=` 指定地址：

```text
http://localhost:5173/?api=http://localhost:8787
```

## 页面路由

路由使用查询参数，便于静态托管：

| URL | 页面 |
| --- | --- |
| `/` | Agent 广场 |
| `?view=new` | 新建聊天选择页 |
| `?agent=<slug>` | 指定 Agent 的聊天页 |
| `?agent=<slug>&session=<id>` | 直达具体会话 |
| `?view=usage` | 我的用量 |

`?api=` 是宿主或联调用的后端地址参数，会在导航时保留。页面不假设与 server 同源。

## 代码结构

```text
src/features/auth/       成员登录表单与 sessionStorage 闸门
src/features/plaza/      Agent 广场
src/features/new-chat/   新建聊天选择
src/features/chat/       输入绑定与资源面板
src/features/layout/     体验页布局、会话侧栏与移动抽屉
src/features/usage/      用量、限额、热力图与额度申请
src/lib/kit.ts           SDK client / controller 启动装配
src/lib/backend.ts       公开 Client 的示例接口映射
src/lib/chat-backend.ts  公开 ChatProvider 的示例后端配置
src/lib/host.ts          宿主能力读取与浏览器降级
src/lib/use-route.ts     查询参数路由
e2e/                     Playwright 全栈与专项用例
```

Agent 资源查询及目录、附件、发送等调用流程复用 `kit-sdk/agents/hooks`、`kit-sdk/sessions/hooks`、`kit-sdk/files/hooks` 与 `kit-sdk/chat/hooks` 的公开 Hooks；
Web 负责后端配置、组件绑定、路由和纯 UI 状态。

## 验证

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
pnpm e2e                  # 构建 server 后启动 mock 全栈，覆盖 web + console
```

`pnpm e2e` 默认使用系统 Chrome；CI 可设 `KIT_E2E_CHANNEL=chromium`。成员登录、用量、
多 Agent 与布局等专项用例各自有独立 Playwright 配置。

## 相关文档

- [体验页不变量](./AGENTS.md)
- [本地 Demo](../../apps/storybook/content/docs/local-demo.mdx)
- [核心概念](../../apps/storybook/content/docs/concepts.mdx)
- [验收矩阵](../../docs/validation.md)
