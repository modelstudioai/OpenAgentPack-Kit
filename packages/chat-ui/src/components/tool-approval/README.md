# tool-approval 工具审批聚合

兼容已有 `kit:add tool-approval` 用法，只重导出单项审批与审批组。

实现分别位于 tool-approval-card、tool-approval-group，审批请求和结果同步经调用方接入公开 SDK。

## Props

本目录只重导出组件，不接收独立 Props；各组件参数见下表。

| 导出 | 参数说明 |
| --- | --- |
| `ToolApprovalCard` | [tool-approval-card](../tool-approval-card/README.md#props) |
| `ToolApprovalGroup` | [tool-approval-group](../tool-approval-group/README.md#props) |

## 导出与使用

本目录维护：ToolApprovalCard、ToolApprovalCardProps、ToolApprovalGroup。

```bash
pnpm kit:add tool-approval
```

源码入口为 [index.ts](index.ts)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[tool-approval-card](../tool-approval-card/README.md)、[tool-approval-group](../tool-approval-group/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/tool-approval.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
