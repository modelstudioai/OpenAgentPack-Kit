# ConfirmDialog 确认弹窗

使用 Radix AlertDialog 呈现需要显式确认的动作，支持忙碌状态与焦点恢复。

- `title` / `body` 展示说明；不可逆操作的 plan diff 由调用方准备并展示。
- `onConfirm` / `onCancel` 触发业务回调，`busy` 防止重复操作。
- 组件不生成 confirmation token，也不执行发布或删除。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | `string` | 是 | — | 操作标题 |
| `body` | `string` | 是 | — | 弹窗正文，通常放真实 plan diff |
| `confirmLabel` | `string` | 否 | `"确认"` | 确认按钮文案 |
| `cancelLabel` | `string` | 否 | `"取消"` | 取消按钮文案 |
| `danger` | `boolean` | 否 | `true` | 危险语义的确认按钮 |
| `busy` | `boolean` | 否 | `false` | 执行中禁用确认、取消和 Escape |
| `onConfirm` | `() => void` | 是 | — | 实际执行；成功后由调用方关闭弹窗 |
| `onCancel` | `() => void` | 是 | — | 取消回调 |

## 导出与使用

本目录维护：ConfirmDialog。

包方式接入仍使用公开入口：

```tsx
import { ConfirmDialog } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add confirm-dialog
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chrome.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
