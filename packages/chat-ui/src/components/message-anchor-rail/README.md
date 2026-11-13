# MessageAnchorRail 回合锚点

为长对话展示用户回合锚点和摘要，定位只滚动消息容器。

- 可通过 MessageList 的 `anchorRail` 自动组合，也可独立渲染。
- 锚点由稳定消息 ID 派生，滚动同步与 reduced-motion 处理随组件维护。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | `readonly MessageAnchorItem[]` | 是 | — | 按回合顺序排列的锚点；少于两项时不显示锚点栏。 |
| `activeIndex` | `number` | 是 | — | 当前激活的锚点索引。 |
| `onSelect` | `((index: number) => void)` | 否 | — | 选择锚点时回传索引，由调用方滚动对应的消息容器。 |
| `className` | `string` | 否 | `""` | 追加到根节点的 Tailwind 工具类。 |

## 导出与使用

本目录维护：MessageAnchorRail；内部 deriveAnchorTurns、useAnchorRailSync 等。

包方式接入仍使用公开入口：

```tsx
import { MessageAnchorRail } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add message-anchor-rail
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[tooltip](../tooltip/README.md)。

同目录测试：[message-anchor-rail.test.tsx](message-anchor-rail.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/message-list.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
