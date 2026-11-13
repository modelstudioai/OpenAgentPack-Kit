# apps/server — Kit Server

OpenAgentPack Kit 的服务端：用 Hono 包装百炼 Managed Agent，向体验页提供数据面 API，
向管理端提供控制面 API。运行时依赖 Node.js 24 与内置 `node:sqlite`。

本文件面向人类读者；修改代码前请先读 [AGENTS.md](./AGENTS.md) 中的不变量和闸门。

## 它提供什么

| 面 | 前缀 | 主要内容 |
| --- | --- | --- |
| 数据面 | `/api/kit/*` | 成员登录、会话、消息与 SSE、工具审批、文件上传/下载、会话目录、用量与限额 |
| 控制面 | `/api/admin/*` | 模版与资源、YAML 资源批次、计划与确认执行、Operation、审计、成员与用量 |
| 公开配置 | `/api/config`、`/healthz` | 前端启动时读取 `apiBaseUrl` 与能力开关；健康检查 |

几个关键设计：

- **事件不落库**：Provider 是 Session、Event 与消息正文的唯一权威；SQLite 只保存目录、
  身份、索引和运营数据。
- **Provider 走 Gateway**：路由不直接调用上游 SDK，`SdkGateway` 与 `MockGateway` 隔离
  Provider 变化，没有凭据时可用 mock 跑完整链路。
- **高风险动作两段式**：apply / destroy / publish / 上下架 / 删除会话先返回 plan 与确认
  令牌，缺令牌一律 `428`，服务端不代替用户确认。
- **身份与归属**：默认成员登录，数据面按 `subjectId` 过滤；管理端区分 `admin` 与只读
  `auditor`。

## 快速开始

从仓库根目录执行：

```bash
pnpm install
cp .env.example .env      # 填入 BAILIAN_API_KEY 与 workspace/base url
pnpm dev server           # http://localhost:8787
```

没有百炼凭据时，直接用 mock gateway：

```bash
KIT_GATEWAY=mock pnpm --filter @openagentpack/kit-server dev
```

只跑已构建的服务端：

```bash
pnpm --filter @openagentpack/kit-server build
node apps/server/dist/bin.js
```

`pnpm dev` 会从仓库根 `.env` 读取配置；单独用 `pnpm --filter ... dev` 时也会加载根 `.env`。

## 常用配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | HTTP 端口 |
| `ADMIN_TOKEN` | 空 | 管理端 bearer token；本地示例为 `change-me`，生产必须替换 |
| `KIT_ADMIN_TOKENS` | 空 | 追加 `token:admin` / `token:auditor`，逗号分隔 |
| `BAILIAN_API_KEY` | 空 | 百炼凭据，仅存在于服务端 |
| `BAILIAN_BASE_URL` / `BAILIAN_WORKSPACE_ID` | 空 | 二选一，用于定位 workspace |
| `KIT_GATEWAY` | `auto` | `auto` 有凭据走 SDK、否则 mock；也可显式 `mock` / `sdk` |
| `KIT_AUTH_MODE` | `member` | 默认成员登录；`anonymous` 仅用于显式演示 |
| `KIT_DATA_DIR` | `.data` | SQLite 与本地数据目录 |
| `KIT_CORS_ORIGINS` | 本地开发来源 | 跨域白名单，支持 `http://127.0.0.1:*` loopback 通配 |
| `KIT_EVAL_WORKSPACES` | 空 | 管理端评测浏览的 workspace 根目录，逗号分隔 |

完整配置与限制参数见 `src/config.ts` 与根 `.env.example`。凭据不会下发浏览器，也不会写进日志。

## 代码结构

```text
src/app.ts          Hono 应用与中间件装配
src/bin.ts          进程入口
src/config.ts       环境变量解析与校验
src/routes/         数据面与控制面 HTTP 路由
src/services/       业务编排、plan/确认、审计、采集与删除
src/gateway/        Provider 适配与脱敏投影
src/store/          SQLite 持久化
src/identity/       成员与管理员身份
tests/              路由、Gateway 合同、服务与恢复场景
openapi.json        由路由声明生成，供文档站同步
```

## 验证

```bash
pnpm --filter @openagentpack/kit-server typecheck
pnpm --filter @openagentpack/kit-server test
pnpm gen:openapi          # 改了路由后重新生成 openapi.json
```

真实 Cloud 验证默认跳过，使用 `KIT_LIVE=1` 与 `.env` 中的测试凭据显式开启；测试资源
使用唯一前缀并在结束后清理。

## 相关文档

- [服务端不变量与闸门](./AGENTS.md)
- [接口与 op 对照表](../../docs/interfaces.md)
- [SSE 帧、重连与错误模型](../../docs/protocol.md)
- [进程与分层](../../docs/architecture.md)
- [验收矩阵](../../docs/validation.md)
