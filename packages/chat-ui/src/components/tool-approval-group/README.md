# ToolApprovalGroup 工具审批组

将多个审批组织成一次显示一张卡的分页视图，复用 ToolApprovalCard。

- `approvals` 是完整审批列表，处理后优先显示剩余待审批项。
- 手动翻页只改变当前选择；决定、刷新、停止回调透传单项卡片。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `approvals` | `ChatToolApproval[]` | 是 | — | 待审批列表，来自 hooks |
| `onDecision` | `(decision: ToolApprovalDecision) => Promise<void>` | 是 | — | 透传给当前卡片 |
| `onRefresh` | `() => Promise<void>` | 是 | — | 透传给当前卡片 |
| `onStop` | `(() => void)` | 否 | — | 透传给当前卡片 |

## 导出与使用

本目录维护：ToolApprovalGroup。

包方式接入仍使用公开入口：

```tsx
import { ToolApprovalGroup } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add tool-approval-group
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[tool-approval-card](../tool-approval-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/tool-approval.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
