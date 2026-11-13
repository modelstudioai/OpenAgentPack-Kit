# ToolCallCard 工具调用

展示工具调用的运行、完成或错误状态及输入输出；完整 JSON 输出复用 CodeHighlighter。

- `part` 使用 SDK 的 tool 消息分片，摘要由 toolSummary 派生。
- `className` / `contentMaxHeight` 控制布局；仅展示已有调用，不执行工具。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `part` | `{ type: "tool"; toolId: string; name: string; status: "running" \| "done" \| "error"; input?: unknown; output?: unknown; startedAt?: string; endedAt?: string; } & { id?: string; }` | 是 | — | 必填，工具分片；字段见 MessagePart |
| `className` | `string` | 否 | — | 同 ReasoningBlock |
| `contentMaxHeight` | `string` | 否 | `"max-h-80"` | 同 ReasoningBlock |

## 导出与使用

本目录维护：ToolCallCard；内部类型 ToolPart。

包方式接入仍使用公开入口：

```tsx
import { ToolCallCard } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add tool-call-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[process-step](../step/README.md)、[tool-summary](../tool-summary/README.md)、[markdown](../../markdown/README.md)、[code-highlighter](../../code-highlighter/README.md)。

同目录测试：[tool-call-card.test.tsx](tool-call-card.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
