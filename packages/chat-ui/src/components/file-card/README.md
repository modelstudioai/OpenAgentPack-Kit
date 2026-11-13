# FileCard 文件卡片

文件展示原语，供产物卡与输入附件复用。

- `name` / `type` / `src` 提供文件身份和可选缩略图。
- `onClick` 与 `onDownload` 分别接入预览和下载；组件不获取文件字节。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | — | 文件名，溢出截断、悬停看全名 |
| `type` | `string` | 否 | — | MIME 类型，参与徽标与类型词判定 |
| `src` | `string` | 否 | — | 调用方提供的缩略图地址，提供时替代字符徽标；组件不读取文件内容 |
| `description` | `ReactNode` | 否 | — | 第二行说明；加载态被「加载中…」占据 |
| `loading` | `boolean` | 否 | `false` | 加载态：阻止操作，第二行固定「加载中…」 |
| `disabled` | `boolean` | 否 | `false` | 禁用操作，整卡变暗 |
| `onClick` | `(() => void)` | 否 | — | 文件名绑定的主入口回调 |
| `onDownload` | `(() => void)` | 否 | — | 下载回调；单独传入时文件名即下载入口，与 `onClick` 同传时渲染独立图标按钮 |
| `className` | `string` | 否 | — | 追加到根节点的 Tailwind 工具类；卡片宽度固定 `w-56` 并随容器收缩 |

## 导出与使用

本目录维护：FileCard。

包方式接入仍使用公开入口：

```tsx
import { FileCard } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add file-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

同目录测试：[file-card.test.tsx](file-card.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/feedback/file-card.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
