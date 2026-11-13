# ProcessStep 执行步骤原语

执行过程的公共视觉骨架：状态标记、摘要、折叠正文与键值展示。

- `verb` / `preview` / `status` 组成摘要，`state` 为 idle / running / done / failed。
- `ariaLabel` 提供可访问名称，`contentMaxHeight` 可覆盖默认正文高度限制。
- 原语随执行组件 copy-in，不从包主入口单独导出。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

### ProcessStep

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `verb` | `ReactNode` | 是 | — | 步骤的主要动作或标题。 |
| `preview` | `ReactNode` | 否 | — | 同一行露出的内容预览（如思考正文首行、工具操作对象）；超出截断。 |
| `status` | `string` | 否 | — | 显示在摘要行尾的状态文案。 |
| `state` | `"done" \| "running" \| "failed" \| "idle"` | 是 | — | 步骤状态，控制状态标记与失败展示。 |
| `ariaLabel` | `string` | 是 | — | 折叠步骤的可访问名称。 |
| `className` | `string` | 否 | `""` | 追加到卡片根节点（details）的工具类。 |
| `contentMaxHeight` | `string` | 否 | `"max-h-80"` | 展开内容区的限高工具类（默认 max-h-80：超长内容卡片内滚动，不撑开页面）。 传入即整体替换默认值——同类工具类叠加会由 CSS 顺序决定胜负，所以不做拼接； 传 "max-h-none" 取消限高。 |
| `children` | `ReactNode` | 是 | — | 展开后显示的步骤正文。 |

### ProcessSpinner

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `className` | `string` | 否 | `""` | 追加到旋转指示图标的 Tailwind 工具类。 |

### ProcessDots

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| — | — | — | — | 无 Props。 |

### ProcessValue

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `label` | `string` | 是 | — | 输入、输出等键值区域的标题。 |
| `children` | `ReactNode` | 是 | — | 键值区域中的展示内容。 |

### ProcessValueCode

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `text` | `string` | 是 | — | 按原有空白与换行展示的文本。 |

## 导出与使用

本目录维护：ProcessStep、ProcessSpinner、ProcessDots、ProcessValue、ProcessValueCode（内部原语）。

这是组件组合使用的内部模块；通过下方 copy-in 条目取得源码，包主入口不单独导出。

```bash
pnpm kit:add process-step
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
