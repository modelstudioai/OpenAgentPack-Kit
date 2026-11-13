# apps/console — 管理端

面向开发者和运营的控制台：配置智能体模版与运行资源、预览调试、上下架，查看 Operation、
成员、用量和评测结果。它只消费控制面 `/api/admin/*`。

本文件面向人类读者；管理端的安全边界、路由与组件栈约定见 [AGENTS.md](./AGENTS.md)。

## 主要功能

- **智能体模版**：从零创建或导入现有 Agent，配置环境、文件、记忆库、密钥库与 Skill，
  预览调试后保存；支持不可变版本历史。
- **上架与下架**：先展示 plan 与影响面，再通过一次性确认令牌执行；缺令牌的服务端请求
  会被拒绝。
- **Operation**：查看 apply / publish / destroy 等长任务的阶段、进度和日志。
- **成员与用量**：创建本地成员、按成员查看 Session 累计用量、设置月度 Token / 执行时长限额。
- **评测浏览**：配置 `KIT_EVAL_WORKSPACES` 后只读浏览 Skill 评测 workspace 与 run。
- **审计**：查看智能体相关操作日志；`auditor` 角色只读。

## 快速开始

```bash
pnpm install
pnpm dev console          # http://localhost:5174
```

或启动完整环境：

```bash
pnpm dev                  # server + web + console + storybook
```

管理端使用 `ADMIN_TOKEN` 登录。本地 `.env.example` 默认是 `change-me`，仅用于开发；
生产环境必须替换。跨域或指定后端时使用：

```text
http://localhost:5174/?api=http://localhost:8787
```

管理员令牌按完整 `apiBaseUrl` 隔离保存在浏览器 localStorage，不进入 URL 或日志。

## 页面路由

| 路径 | 页面 |
| --- | --- |
| `/templates` | 智能体模版列表 |
| `/templates/new` | 创建模版 |
| `/templates/:id` | 模版详情 |
| `/templates/:id/edit` | 编辑模版 |
| `/templates/:id/debug` | 模版调试 |
| `/operations` | Operation 与审计 |
| `/usage` | 用量总览 |
| `/members` | 成员列表 |
| `/members/:id/usage` | 成员用量详情 |
| `/eval` | 评测浏览 |

页面使用 Browser History 路径路由；表单草稿、密码、凭据和确认令牌不进入 URL。

## 代码结构

```text
src/features/auth/          管理员登录
src/features/templates/     模版创建、编辑、资源、版本与调试
src/features/preset-packs/  导入预设包与资源选择
src/features/members/       成员目录与成员用量
src/features/usage/         用量聚合与限额
src/features/operations/    Operation 与审计页面
src/features/navigation/    路径路由与侧栏布局
src/lib/admin/              Kit 管理客户端、成员用量、Operation 恢复及 React hooks
src/lib/antd-theme.ts       antd token 统一配置
```

UI 组件栈：重控件（表格、表单、树、上传）优先 antd v6；对话链路组件一律使用
`@openagentpack/kit-chat-ui`。antd 只允许出现在本应用，见 ADR-0015。

## 管理端调用层

`src/lib/api.ts` 通过 `getAdminClient()` 装配带当前管理员身份的 Request；固定控制面路由、
协议头和响应包装由 `src/lib/admin/client.ts` 负责。成员用量控制器在 `member-usage.ts`，
Operation 观察与恢复在 `operation.ts`；页面通过同目录的 hooks 订阅。

这些业务不属于公开 SDK，`@openagentpack/kit-sdk/admin` 已移除。查询、提交和订阅复用
SDK 根入口的 `createQuery`、`createMutation`、`createObservable`；帧读取复用
`streamProtocolFrames`。不从 SDK 私有源码导入，也不维护第二份解析或状态实现。

例如在本应用的无 React 调用方中，显式管理成员用量的订阅与释放：

```ts
import { getAdminClient } from "./src/lib/api.ts";
import { createMemberUsageController, type MemberUsageSnapshot } from "./src/lib/admin/index.ts";

function observeMemberUsage(memberId: string, render: (snapshot: MemberUsageSnapshot) => void) {
  const controller = createMemberUsageController(getAdminClient(), memberId);
  const unsubscribe = controller.subscribe(() => render(controller.getSnapshot()));
  render(controller.getSnapshot());
  void controller.start();
  return () => {
    unsubscribe();
    controller.dispose();
  };
}
```

成员汇总来自服务端全量结果；筛选重置分页，轮询只观察采集结果。Operation 仅重连原操作的
观测流，不重发发布；迟到 GET 不覆盖 SSE，终态不回退，离页释放订阅并取消读取。
完整边界见 [ADR-0025](../../docs/adr/0025-console-owns-admin-client.md)。

## 验证

```bash
pnpm --filter console typecheck
pnpm --filter console test
pnpm --filter console build
pnpm e2e                  # 管理端浏览器流程由 apps/web/e2e 统一覆盖
```

## 相关文档

- [管理端不变量](./AGENTS.md)
- [antd 仅限 console](../../docs/adr/0015-antd-console-only.md)
- [接口与 op 对照表](../../docs/interfaces.md)
- [验收矩阵](../../docs/validation.md)
