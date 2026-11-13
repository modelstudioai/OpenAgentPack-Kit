# ProcessingIndicator 生成提示

消息正文末尾和首帧前共用的生成提示行，复用执行步骤的旋转指示。

- `label` 默认为“生成中…”，`className` 调整外层布局。
- 由 Message / MessageList 组合使用，不从包主入口单独导出。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `className` | `string` | 否 | `""` | 追加到根节点的 Tailwind 工具类。 |
| `label` | `string` | 否 | `"生成中…"` | 等待或生成中的提示文案。 |

## 导出与使用

本目录维护：ProcessingIndicator（内部组件）。

这是组件组合使用的内部模块；通过下方 copy-in 条目取得源码，包主入口不单独导出。

```bash
pnpm kit:add processing-indicator
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[process-step](../process/step/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/message-list.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
