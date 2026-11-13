# PlazaCard 智能体卡片

展示智能体身份、分类、能力、示例问题和使用摘要。

- `entry` 使用 SDK 的 PlazaEntry，`onOpen` 返回选中的 slug。
- 卡片按钮触发导航回调，不查询资源或创建会话。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `entry` | `{ slug: string; display_name: string; suggested_prompts: string[]; capabilities: { streaming: boolean; fileUpload: boolean; artifacts: boolean; threads: boolean; reasoning: boolean; }; category: "other" \| "data" \| "general" \| "writing" \| "coding"; featured: boolean; stats: { mine: boolean; turns_30d: number; last_used_at?: string \| undefined; }; description?: string \| undefined; icon?: string \| undefined; opening_remarks?: string \| undefined; theme?: { accent?: string \| undefined; iconBackground?: string \| undefined; } \| undefined; }` | 是 | — | 必填，来自 `@openagentpack/kit-sdk/protocol`，包括 Agent 展示信息和 stats |
| `onOpen` | `(slug: string) => void` | 是 | — | 必填，由调用方更新路由、选中 Agent 与会话状态 |

## 导出与使用

本目录维护：PlazaCard；内部时间文案辅助函数 relativeUsedLabel。

包方式接入仍使用公开入口：

```tsx
import { PlazaCard } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add plaza-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[agent-header](../agent-header/README.md)。

同目录测试：[plaza.test.tsx](plaza.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/plaza.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
