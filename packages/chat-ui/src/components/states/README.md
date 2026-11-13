# states 状态组件聚合

兼容状态组件的组合引用与 `kit:add states`，只重导出空态和错误态。

组件实现与说明分别位于 empty-state、error-state 目录，数据加载和重试始终由调用方管理。

## Props

本目录只重导出组件，不接收独立 Props；各组件参数见下表。

| 导出 | 参数说明 |
| --- | --- |
| `EmptyState` | [empty-state](../empty-state/README.md#props) |
| `ErrorState` | [error-state](../error-state/README.md#props) |

## 导出与使用

本目录维护：EmptyState、ErrorState。

```bash
pnpm kit:add states
```

源码入口为 [index.ts](index.ts)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[empty-state](../empty-state/README.md)、[error-state](../error-state/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
