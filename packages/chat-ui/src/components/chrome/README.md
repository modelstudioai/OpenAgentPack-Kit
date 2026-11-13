# chrome 页面辅助组件聚合

兼容已有 `kit:add chrome` 用法，只重导出组件，不承载视觉实现。

独立实现位于 agent-header、status-indicator、thread-panel、confirm-dialog、empty-state、error-state 目录；可按需分别 copy-in。

## Props

本目录只重导出组件，不接收独立 Props；各组件参数见下表。

| 导出 | 参数说明 |
| --- | --- |
| `AgentHeader` | [agent-header](../agent-header/README.md#props) |
| `isIconImageSource` | [agent-header](../agent-header/README.md#props) |
| `StatusIndicator` | [status-indicator](../status-indicator/README.md#props) |
| `ThreadPanel` | [thread-panel](../thread-panel/README.md#props) |
| `ConfirmDialog` | [confirm-dialog](../confirm-dialog/README.md#props) |
| `EmptyState` | [empty-state](../empty-state/README.md#props) |
| `ErrorState` | [error-state](../error-state/README.md#props) |

## 导出与使用

本目录维护：AgentHeader、StatusIndicator、ThreadPanel、ConfirmDialog、EmptyState、ErrorState 等。

```bash
pnpm kit:add chrome
```

源码入口为 [index.ts](index.ts)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[agent-header](../agent-header/README.md)、[confirm-dialog](../confirm-dialog/README.md)、[status-indicator](../status-indicator/README.md)、[thread-panel](../thread-panel/README.md)、[states](../states/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
