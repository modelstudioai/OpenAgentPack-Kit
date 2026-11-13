# SubAgentPanel 子 Agent 面板

按 Agent 展示派发任务概览，通过弹窗查看一次任务的执行记录。

- `multiAgent` 注入 SDK 的线程摘要、消息和历史操作。
- 详情复用 SubAgentCard 的记录展示与加载反馈，弹窗维护焦点与开关状态。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `multiAgent` | `ChatMultiAgent` | 否 | — | 当前会话的子 Agent 快照，直接传 `useChat().multiAgent`；`threads` 按展示名去重分组，组内按创建时间倒序（最新派发在前） |
| `className` | `string` | 否 | `""` | 追加到分区根节点的 Tailwind 工具类，用于宿主布局 |

## 导出与使用

本目录维护：SubAgentPanel。

包方式接入仍使用公开入口：

```tsx
import { SubAgentPanel } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add sub-agent-panel
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[sub-agent-card](../sub-agent-card/README.md)。

同目录测试：[sub-agent-panel.test.tsx](sub-agent-panel.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/general/sub-agent-panel.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
