# Chat 对话组合

组合消息列表、Suggestion 候选与输入框，统一传递会话状态、附件操作和多 Agent 数据。

- `messages`、`multiAgent` 来自公开 SDK，发送、停止与历史操作由回调接入。
- `canSend` 等状态控制输入门控，输入草稿属于组件交互状态。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `messages` | `ChatMessage[]` | 是 | — | 主 Agent 消息，传给 MessageList |
| `variant` | `"default" \| "workspace"` | 否 | `"default"` | workspace 用 `--kit-chat-width` 居中阅读宽度对齐消息、审批与输入区 |
| `turnRunning` | `boolean` | 否 | `false` | 默认 Sender 是否显示停止按钮 |
| `sending` | `boolean` | 否 | `false` | 发送请求在途（含新建会话）：乐观气泡出现前列表尾显示「发送中…」指示，回合开始后归「生成中…」 |
| `canSend` | `boolean` | 否 | `true` | 是否允许提交；设 false 仍可编辑草稿 |
| `composerDisabled` | `boolean` | 否 | `false` | 禁用默认输入区，例如配额耗尽；已有生成仍可停止。自定义 sender 需自行传入 disabled |
| `approvals` | `ReactNode` | 否 | — | 主 Agent 当前待办审批卡，内嵌到消息流末尾；输入区上方只留精简等待提示 |
| `multiAgent` | `ChatMultiAgent` | 否 | — | 直接传入 `useChat().multiAgent`，在消息流中展示子 Agent 卡片、只读历史、分页与重试 |
| `onSend` | `((text: string, skills?: string[]) => void \| Promise<void>)` | 否 | — | 默认 Sender 提交文本和派生技能名；成功后清理未被改写的草稿 |
| `onStop` | `(() => void \| Promise<void>)` | 否 | — | 默认 Sender 的停止回调 |
| `onArtifactDownload` | `((fileId: string) => void)` | 否 | — | 文件下载回调 |
| `onArtifactOpen` | `((fileId: string, contentType?: string) => void)` | 否 | — | 文件名称的预览回调；与下载入口独立 |
| `onCopy` | `((text: string) => void \| Promise<void>)` | 否 | 浏览器剪贴板 | 回答复制能力，透传到 MessageList；Web 体验页接入本地宿主能力 |
| `empty` | `ReactNode` | 否 | — | 消息为空时的占位（欢迎态）；输入区保持挂载，消息出现后退出 |
| `scrollKey` | `string \| null` | 否 | — | 逻辑会话标识；变化时恢复滚底跟随 |
| `sender` | `ReactNode` | 否 | — | 替换默认 Sender |
| `skills` | `SenderSkill[]` | 否 | — | 当前 Agent 的技能候选，传给默认 Sender 与消息列表；自定义 sender 需另行传入 |
| `anchorRail` | `boolean` | 否 | `false` | 主会话右缘显示回合锚点栏；规则见 MessageList 回合锚点栏 |
| `virtualize` | `boolean` | 否 | `true` | 长会话分窗渲染开关，透传 MessageList |

## 导出与使用

本目录维护：Chat。

包方式接入仍使用公开入口：

```tsx
import { Chat } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add chat
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[suggestion](../suggestion/README.md)、[sender](../sender/README.md)、[message](../message/README.md)、[process-step](../process/step/README.md)。

同目录测试：[chat.test.tsx](chat.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/chat.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
