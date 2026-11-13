# MessageListSkeleton 消息骨架

展示会话历史读取期间的消息骨架。

- `className` 可调整外层布局。
- 通常传入 MessageList 的 `empty` 插槽，加载状态由调用方控制。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `className` | `string` | 否 | `""` | 追加到骨架屏根容器的 Tailwind 工具类。 |

## 导出与使用

本目录维护：MessageListSkeleton。

包方式接入仍使用公开入口：

```tsx
import { MessageListSkeleton } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add message-skeleton
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[message-skeleton.test.tsx](message-skeleton.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/message-list.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
