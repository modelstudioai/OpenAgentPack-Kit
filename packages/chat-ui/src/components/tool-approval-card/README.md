# ToolApprovalCard 工具审批

展示单项工具审批参数、结果与允许/拒绝入口，提供提交反馈。

- `approval` 由 SDK 注入，`onDecision` 接收审批决定，`onRefresh` 重新读取状态。
- `onStop` 可接入停止操作；组件不直接访问审批 API。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `approval` | `ChatToolApproval` | 是 | — | 当前请求、实际参数、可操作性与状态，来自 hooks |
| `onDecision` | `(decision: ToolApprovalDecision) => Promise<void>` | 是 | — | 提交允许或拒绝；失败显示错误行并保持可重试 |
| `onRefresh` | `() => Promise<void>` | 是 | — | 重新查询审批结果与有效待办 |
| `onStop` | `(() => void)` | 否 | — | 中断整个执行，独立于拒绝单个工具；仅在卡片不可操作时显示「停止执行」 |

## 导出与使用

本目录维护：ToolApprovalCard、ToolApprovalCardProps。

包方式接入仍使用公开入口：

```tsx
import { ToolApprovalCard } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add tool-approval-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[tool-approval.test.tsx](tool-approval.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/tool-approval.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
