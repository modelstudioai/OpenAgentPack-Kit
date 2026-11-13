# CodeHighlighter 代码高亮

展示语法高亮代码、行号与复制工具栏，未知语言按纯文本呈现。

- `children` 提供代码字符串，`lang` 指定语言。
- `copyable` 控制复制入口，工具栏与行号由相应 props 配置。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `children` | `string` | 是 | — | 原始代码文本；组件只渲染，不执行 |
| `lang` | `string` | 否 | — | 语言名，大小写不敏感；未注册语言按纯文本展示 |
| `header` | `ReactNode \| (() => ReactNode)` | 否 | 未传时显示语言名 | 工具栏标题；传 ReactNode 自定义（函数则以返回节点为标题），`false` 隐藏整个工具栏 |
| `copyable` | `boolean` | 否 | `true` | 工具栏内的复制按钮（Actions.Copy），隐藏工具栏时一并隐藏 |
| `showLineNumbers` | `boolean` | 否 | `false` | 显示行号；行号不参与复制与朗读 |
| `className` | `string` | 否 | — | 根节点 Tailwind 工具类 |

## 导出与使用

本目录维护：CodeHighlighter。

包方式接入仍使用公开入口：

```tsx
import { CodeHighlighter } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add code-highlighter
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[actions](../actions/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/code-highlighter.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
