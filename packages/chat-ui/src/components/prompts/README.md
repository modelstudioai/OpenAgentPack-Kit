# Prompts 提示集

展示示例问题与能力入口，支持嵌套分组、禁用及多种排列方式。

- `items` 注入提示项，`onItemClick` 接收选中的条目。
- 点击后填入输入框或发起对话由调用方决定；组件不发送消息。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

同时透传声明中继承的标准 div 属性；表中列出提示集参数与常用 `className`。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | `PromptsItem[]` | 否 | `[]` | 提示条目；为空时组件不渲染，标题也不显示 |
| `title` | `ReactNode` | 否 | — | 列表上方的标题 |
| `onItemClick` | `((info: { data: PromptsItem; }) => void)` | 否 | — | 点击可用条目时回调；分组卡片不触发，点击子项时 `data` 为该子项 |
| `vertical` | `boolean` | 否 | `false` | 纵向排列；与 `wrap` 同时传入时优先 |
| `wrap` | `boolean` | 否 | `false` | 横向换行，窄屏逐行排列；与 `vertical` 都不传时单行横向滚动 |
| `fadeIn` | `boolean` | 否 | `false` | 挂载时逐项淡入 |
| `fadeInLeft` | `boolean` | 否 | `false` | 逐项从左侧淡入；与 `fadeIn` 同时传入时优先 |
| `classNames` | `Partial<Record<PromptsSemantic, string>>` | 否 | `{}` | 各部位追加的工具类，键见下表 |
| `className` | `string` | 否 | — | 根节点 class，等同 `classNames.root` |

## 导出与使用

本目录维护：Prompts。

包方式接入仍使用公开入口：

```tsx
import { Prompts } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add prompts
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[prompts.test.tsx](prompts.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/wake/prompts.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
