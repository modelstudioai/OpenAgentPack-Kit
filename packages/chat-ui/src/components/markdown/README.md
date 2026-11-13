# Markdown 富文本

将 Markdown 字符串渲染为安全的富文本，支持 GFM、代码高亮与 Mermaid 围栏。

- `children` 是 Markdown 字符串。
- 代码和图表展示分别复用 CodeHighlighter 与 Mermaid，不另建渲染器。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `children` | `string` | 是 | — | Markdown 原文 |

## 导出与使用

本目录维护：Markdown。

包方式接入仍使用公开入口：

```tsx
import { Markdown } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add markdown
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[code-highlighter](../code-highlighter/README.md)、[mermaid](../mermaid/README.md)。

同目录测试：[markdown.test.tsx](markdown.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
