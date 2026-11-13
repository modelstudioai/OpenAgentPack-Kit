# ErrorState 错误态

展示错误说明和可选的重试入口。

- `message` 提供可展示文案。
- `onRetry` 提供时显示重试按钮；是否重试及请求状态由调用方处理。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `message` | `string` | 是 | — | 完整错误说明，支持换行 |
| `onRetry` | `(() => void)` | 否 | — | 由调用方重新加载或恢复 |

## 导出与使用

本目录维护：ErrorState。

包方式接入仍使用公开入口：

```tsx
import { ErrorState } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add error-state
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
