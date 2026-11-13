# Mermaid 图表

渲染 Mermaid 图表并提供源码视图；流式内容未完整时保留等待与降级展示。

- `children` 为图表源码，主题跟随组件所在作用域。
- 解析失败可查看源码，复制与代码视图复用既有组件。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `children` | `string` | 是 | — | Mermaid 原始源码 |
| `header` | `ReactNode` | 否 | `"Mermaid 图表"` | 卡头标题 |
| `className` | `string` | 否 | — | 追加到根节点的 Tailwind 工具类 |
| `defaultRenderType` | `"code" \| "image"` | 否 | `"image"` | 初始视图；之后由卡头切换按钮控制 |
| `copyable` | `boolean` | 否 | `true` | 显示复制源码按钮 |
| `streaming` | `boolean` | 否 | `false` | 生成中只展示源码；置回 `false` 自动渲染 |
| `onRenderTypeChange` | `((value: "image" \| "code") => void)` | 否 | — | 用户切换视图的通知 |

## 导出与使用

本目录维护：Mermaid。

包方式接入仍使用公开入口：

```tsx
import { Mermaid } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add mermaid
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[actions](../actions/README.md)、[code-highlighter](../code-highlighter/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/mermaid.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
