# ThreadPanel 子线程

按线程 ID 分组展示已有消息，复用 Message 渲染分片。

- `threads` 是线程 ID 到 SDK 消息数组的映射。
- `onArtifactDownload` / `onCopy` 透传消息操作；新多 Agent 体验也可使用 SubAgentPanel。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `threads` | `Record<string, ChatMessage[]>` | 是 | — | 线程 id 到消息数组的映射；空记录整体不渲染 |
| `onArtifactDownload` | `((fileId: string) => void)` | 否 | — | 透传给 Message 的产物下载回调 |
| `onCopy` | `((text: string) => void \| Promise<void>)` | 否 | — | 透传给 Message 的复制回调 |

## 导出与使用

本目录维护：ThreadPanel。

包方式接入仍使用公开入口：

```tsx
import { ThreadPanel } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add thread-panel
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[message](../message/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
