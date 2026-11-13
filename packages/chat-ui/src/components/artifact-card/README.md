# ArtifactCard 产物卡片

以 FileCard 展示 Agent 交付的文件，不持有文件下载协议。

- `filename` / `contentType` 描述文件。
- `onOpen` / `onDownload` 接入调用方提供的预览和下载流程。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `filename` | `string` | 是 | — | 必填，文件名 |
| `contentType` | `string` | 否 | — | MIME 类型，决定图标 |
| `onOpen` | `(() => void)` | 否 | — | 点击文件名打开预览 |
| `onDownload` | `(() => void)` | 否 | — | 下载 |

## 导出与使用

本目录维护：ArtifactCard。

包方式接入仍使用公开入口：

```tsx
import { ArtifactCard } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add artifact-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[file-card](../file-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
