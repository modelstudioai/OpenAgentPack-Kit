# Sender 输入框

维护受控文本输入、技能 chip、提交、停止、附件粘贴及头尾插槽。Header 和编辑器辅助逻辑属于同一个复合输入控件。

- `value` / `onChange` 控制草稿，`onSubmit` 提交输入，`onCancel` 停止生成。
- `loading` / `disabled` 控制交互门控，`skills` 指定可投影成 chip 的技能，候选弹层由 `Suggestion` 组合。
- 只触发回调，实际请求、会话状态与上传流程经公开 SDK 接入。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

### Sender

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `variant` | `"default" \| "workspace"` | 否 | `"default"` | 工作区布局或同行默认布局 |
| `value` | `string` | 否 | — | 受控输入值；省略时使用组件内部草稿。 |
| `defaultValue` | `string` | 否 | `""` | 非受控模式的初始草稿，受控模式下不使用。 |
| `onChange` | `((value: string) => void)` | 否 | — | 输入变化 |
| `onSubmit` | `((message: string, skills?: string[]) => void)` | 否 | — | 提交；不会自动清空，第二参数是从正文标记派生的技能名（无标记时省略） |
| `onCancel` | `(() => void)` | 否 | — | `loading` 时点击停止 |
| `onKeyDown` | `((event: KeyboardEvent<HTMLDivElement>) => void)` | 否 | — | 先于内置提交逻辑；`preventDefault()` 可拦截提交，便于接入 Suggestion |
| `onPasteFile` | `((files: File[]) => void)` | 否 | — | 粘贴内容含文件时触发，并阻止文件名写进输入框 |
| `loading` | `boolean` | 否 | `false` | 发送按钮变为停止按钮 |
| `submitDisabled` | `boolean` | 否 | `false` | 仅禁发（按钮和回车），草稿仍可编辑；等待审批/重连用 `!chat.canSend` |
| `disabled` | `boolean` | 否 | `false` | 禁用输入和发送等动作；生成中的停止按钮仍可使用 |
| `readOnly` | `boolean` | 否 | `false` | 输入只读且不可提交 |
| `placeholder` | `string` | 否 | 随提交方式变化 | 占位文案 |
| `skills` | `SenderSkill[]` | 否 | — | 当前 Agent 已绑定技能；已知 `/name ` 标记渲染成 chip，候选由 Suggestion 提供 |
| `onSelectionChange` | `(selection: SenderSelection) => void` | 否 | — | 回传文本选区的 `start` / `end`，用于 Suggestion 的光标定位 |
| `submitType` | `SenderSubmitType` | 否 | `"enter"` | 回车、Shift+Enter 或仅按钮提交；输入法合成期间不会提交 |
| `autoSize` | `boolean \| { minRows?: number; maxRows?: number; }` | 否 | `{ minRows: 1, maxRows: 6 }` | 按换行和窄屏自动折行调整高度；`false` 固定一行 |
| `inputProps` | `(AriaAttributes & { id?: string; role?: AriaRole; })` | 否 | — | 输入框的辅助技术属性；可直接接入 Suggestion 提供的 `inputProps` |
| `prefix` | `ReactNode` | 否 | — | 默认在输入框前；工作区布局在底部工具栏左侧 |
| `suffix` | `ReactNode \| ((origin: ReactNode, info: { components: SenderComponents; }) => ReactNode)` | 否 | 默认发送/停止 | 默认在输入框后；工作区布局在底部工具栏右侧；函数可组合默认按钮与 `components` |
| `header` | `ReactNode` | 否 | — | 边框内、输入区上方内容，通常传 `Sender.Header` |
| `footer` | `ReactNode \| ((info: { components: SenderComponents; }) => ReactNode)` | 否 | — | 边框内底部内容 |
| `className` | `string` | 否 | — | 根节点 / 分区插槽样式 |
| `classNames` | `Partial<Record<SenderSemantic, string>>` | 否 | `{}` | 根节点 / 分区插槽样式 |

### Sender.Header / SenderHeader

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | `ReactNode` | 否 | — | 标题 |
| `open` | `boolean` | 否 | `false` | 是否渲染 |
| `onOpenChange` | `((open: boolean) => void)` | 否 | — | 关闭回调 |
| `closable` | `boolean` | 否 | `true` | 是否显示关闭按钮 |
| `children` | `ReactNode` | 否 | — | 面板内容 |
| `className` | `string` | 否 | — | 根节点 class |

`SenderRef.replaceRange(start, end, text)` 替换文本范围并恢复光标；与 Suggestion 的选择上下文组合插入技能。

## 导出与使用

本目录维护：Sender、Sender.Header / SenderHeader；技能输入辅助函数。

包方式接入仍使用公开入口：

```tsx
import { Sender } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add sender
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

技能候选组合见 [Suggestion](../suggestion/README.md)；单独复制 Sender 不包含候选弹层。

同目录测试：[sender.test.tsx](sender.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/express/sender.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
