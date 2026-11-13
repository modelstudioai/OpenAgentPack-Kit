# EmptyState 空态

以统一布局展示欢迎、无数据或加载中的提示。

- `title` 是主要文案，`hint` 提供补充说明。
- `loading` 开启加载指示和辅助技术状态播报。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | `string` | 是 | — | 状态标题或开场文案 |
| `hint` | `string` | 否 | — | 补充说明 |
| `loading` | `boolean` | 否 | `false` | 显示低强调进度标记，并用 `role="status"` 表达加载状态 |

## 导出与使用

本目录维护：EmptyState。

包方式接入仍使用公开入口：

```tsx
import { EmptyState } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add empty-state
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
