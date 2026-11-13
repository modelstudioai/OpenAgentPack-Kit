# Attachments 附件

提供附件列表、选择与拖放入口、上传进度和移除交互。单文件卡片作为静态子组件及兼容别名一起维护。

- `items` 注入文件列表及上传状态，`onSelectFiles` 接收用户选中的文件。
- `onRemove` 处理移除，`disabled` / `maxCount` 控制入口；实际上传与取消由调用方负责。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

### Attachments

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | `AttachmentItem[]` | 否 | `[]` | 附件列表，由调用方维护并写回 |
| `onSelectFiles` | `((files: File[]) => void)` | 否 | — | 内置选择或拖放得到文件时触发；上传由调用方完成，再把结果写回 `items` |
| `onPick` | `(() => void)` | 否 | — | 使用宿主文件选择器（如 Electron 对话框），提供后不再渲染内置 file input |
| `onRemove` | `((item: AttachmentItem) => void)` | 否 | — | 移除已完成或失败的文件；上传中的文件不显示移除入口 |
| `accept` | `string` | 否 | — | 传给内置 file input 的文件类型 |
| `multiple` | `boolean` | 否 | `true` | 是否多选 |
| `maxCount` | `number` | 否 | — | 数量上限；内置选择与拖放只接收剩余数量的文件 |
| `disabled` | `boolean` | 否 | `false` | 禁止选择、拖放与移除 |
| `overflow` | `"wrap" \| "scrollX" \| "scrollY"` | 否 | `"wrap"` | 列表溢出策略：换行 / 横向滚动 / 纵向滚动（容器限高） |
| `placeholder` | `AttachmentsPlaceholder \| ((type: "inline" \| "drop") => AttachmentsPlaceholder)` | 否 | 内置文案 | 空列表占位与拖放覆盖层的提示 |
| `getDropContainer` | `(() => HTMLElement \| null \| undefined)` | 否 | 组件根节点 | 扩大拖放区域；目标元素需 `position: relative`，拖放提示覆盖其上 |
| `className` | `string` | 否 | — | 根节点的 Tailwind 工具类 |
| `classNames` | `Partial<Record<AttachmentsSemantic, string>>` | 否 | `{}` | 语义槽位工具类：`root / list / item / placeholder / drop` |

### Attachments.FileCard / AttachmentFileCard

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `item` | `AttachmentItem` | 是 | — | 文件数据：名称、大小、类型、缩略图、上传状态与说明 |
| `onRemove` | `((item: AttachmentItem) => void)` | 否 | — | 提供后显示移除入口，点击回传当前文件；列表更新由调用方负责 |
| `disabled` | `boolean` | 否 | `false` | 禁用卡片操作并隐藏移除入口 |
| `className` | `string` | 否 | — | 卡片根节点的 Tailwind 工具类 |

## 导出与使用

本目录维护：Attachments、Attachments.FileCard / AttachmentFileCard。

包方式接入仍使用公开入口：

```tsx
import { Attachments } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add attachments
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[file-card](../file-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/express/attachments.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
