# ReasoningBlock 思考过程

以 ProcessStep 展示思考摘要与完整文本，默认收起并允许手动展开。

- `text` 是累计文本，首个非空行作为摘要。
- `status` 支持 streaming / done / failed / interrupted，`contentMaxHeight` 控制正文高度。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | `string` | 是 | — | 必填，思考原文；摘要行取首个非空行 |
| `status` | `"streaming" \| "done" \| "failed" \| "interrupted"` | 否 | — | 思考状态；缺省不标记完成 |
| `className` | `string` | 否 | — | 追加到根 `details` 的工具类 |
| `contentMaxHeight` | `string` | 否 | `"max-h-80"` | 展开内容限高工具类，整体替换默认值；`max-h-none` 取消限高 |

## 导出与使用

本目录维护：ReasoningBlock。

包方式接入仍使用公开入口：

```tsx
import { ReasoningBlock } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add reasoning-block
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[process-step](../step/README.md)。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
