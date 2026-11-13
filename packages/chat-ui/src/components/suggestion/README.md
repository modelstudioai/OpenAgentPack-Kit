# Suggestion 快捷指令

为输入框提供级联候选、键盘移动和选择交互。

- `items` 配置候选树；`value` / `caret` / `trigger` 自动识别查询，也可通过 `onTrigger` 手动开关。
- 自动查询变化或结束时重置高亮；同一查询的候选更新时将高亮限制在有效范围，Enter / Tab 选择当前高亮项。
- `open` 可控制显隐，`children` 渲染输入控件。
- 选择结果交给调用方更新草稿，不发起后端请求。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | `SuggestionItem[] \| ((info?: T \| undefined) => SuggestionItem[])` | 否 | `[]` | 静态或按触发信息动态生成的候选 |
| `value` | `string` | 否 | — | 自动触发读取的受控文本 |
| `caret` | `number` | 否 | `value.length` | 光标在文本中的位置 |
| `trigger` | `string \| ((state: { value: string; caret: number }) => { start: number; query: string } \| null)` | 否 | — | 词首触发符或自定义查询检测；省略时使用手动模式 |
| `filter` | `(item: SuggestionItem, query: string) => boolean` | 否 | 值/关键词前缀匹配 | 过滤当前候选，可排除已插入项 |
| `open` | `boolean` | 否 | — | 受控打开状态 |
| `onOpenChange` | `((open: boolean) => void)` | 否 | — | 打开状态变化 |
| `onSelect` | `((value: string, item: SuggestionItem, context: SuggestionSelectContext \| undefined) => void)` | 否 | — | 返回叶子项及触发范围；有子项的条目只展开下一列 |
| `block` | `boolean` | 否 | `false` | 根节点与弹层占满可用宽度 |
| `children` | `(props: SuggestionRenderProps<T>) => ReactNode` | 是 | — | 渲染触发输入框 |
| `className` | `string` | 否 | — | 根节点 class |
| `classNames` | `Partial<Record<SuggestionSemantic, string>>` | 否 | `{}` | 各语义区域的 Tailwind 工具类，键为 SuggestionSemantic。 |

`SuggestionItem` 支持 `description`、`keywords` 与 `data`；选中时原样返回业务元数据。
`SuggestionSelectContext` 含 `trigger`、`query`、`start`、`end`，可交给 `SenderRef.replaceRange` 插入技能。

## 导出与使用

本目录维护：Suggestion。

包方式接入仍使用公开入口：

```tsx
import { Suggestion } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add suggestion
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/express/suggestion.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
