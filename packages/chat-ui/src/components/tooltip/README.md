# Tooltip 提示

鼠标悬停或键盘聚焦时显示提示，并处理视口碰撞与文本截断场景。

- `content` 提供提示内容，`children` 提供触发元素，`side` 指定方向。
- 定位和展开状态归组件，视觉使用主题 token。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `content` | `ReactNode` | 否 | — | 气泡内容，支持任意 ReactNode（标题 + 摘要、多行文本）；空值不显示气泡 |
| `side` | `TooltipSide` | 否 | `"top"` | 气泡相对触发器的方位；贴边触发器（如锚点栏）用 `left` / `right` |
| `overflowOnly` | `boolean` | 否 | `false` | 仅当触发内容真的被截断（`scrollWidth` / `scrollHeight` 超出 client 区）才显示 |
| `className` | `string` | 否 | — | 添加到触发器元素；`truncate` 等截断类放在这里 |
| `children` | `ReactNode` | 是 | — | 触发器内容 |

## 导出与使用

本目录维护：Tooltip；内部定位辅助函数 resolveTransform。

包方式接入仍使用公开入口：

```tsx
import { Tooltip } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add tooltip
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[tooltip.test.tsx](tooltip.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/basic/tooltip.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
