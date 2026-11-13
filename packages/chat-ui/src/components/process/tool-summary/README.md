# toolSummary 工具摘要

从工具名和输入生成摘要动词与可选徽标，供 ToolCallCard 复用。

- `name` / `input` 为已有工具调用信息。
- 文件、搜索和命令工具有既有模板，未知工具降级为名称和首个字符串字段。
- 不修改输入、不执行请求，不从包主入口导出。

## 参数

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | — | 工具名称，用于选择已有摘要模板；未知工具以名称兜底。 |
| `input` | `unknown` | 否 | — | 工具输入；从中提取文件名、搜索词、命令或首个字符串作为摘要。 |

返回 `ToolSummary`：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `verb` | `string` | 是 | 摘要动作或兜底工具名称。 |
| `badge` | `string` | 否 | 可选的操作对象摘要。 |

## 导出与使用

本目录维护：toolSummary、ToolSummary（内部纯函数）。

这是组件组合使用的内部模块；通过下方 copy-in 条目取得源码，包主入口不单独导出。

```bash
pnpm kit:add tool-summary
```

源码入口为 [index.ts](index.ts)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
