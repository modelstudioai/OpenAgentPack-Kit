# Message 单条消息

展示一条 SDK `ChatMessage`：角色布局、消息分片、发送状态、时间与复制入口。列表滚动逻辑已归入独立的 message-list 目录。

- `message` 是展示事实，`variant` 控制默认或 workspace 布局。
- `multiAgent` 注入子 Agent 状态；`skills` 用于恢复技能标记。
- 文件打开、下载和复制通过回调处理。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `message` | `ChatMessage` | 是 | — | 必填，单条消息的展示模型，见下表 |
| `variant` | `"default" \| "workspace"` | 否 | `"default"` | 消息布局；工作区下用户为气泡，Agent 正文无外框 |
| `onArtifactDownload` | `((fileId: string) => void)` | 否 | — | 交付文件下载，由调用方通过 Kit server 或自有后端完成 |
| `onArtifactOpen` | `((fileId: string, contentType?: string) => void)` | 否 | — | 点击交付文件名称时打开预览，与下载回调独立 |
| `onCopy` | `((text: string) => void \| Promise<void>)` | 否 | 浏览器剪贴板 | Agent 回答原文复制；成功后 resolve，失败时抛出异常 |
| `multiAgent` | `ChatMultiAgent` | 否 | — | 子 Agent 状态、历史查询与重试能力，来自 `useChat().multiAgent`；省略时不显示子 Agent 卡片 |
| `skills` | `string[]` | 否 | — | 当前 Agent 的技能名，用于还原用户正文中的已知技能 token |

## 导出与使用

本目录维护：Message；重导出 ArtifactCard、ReasoningBlock、ToolCallCard 等。

包方式接入仍使用公开入口：

```tsx
import { Message } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add message
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[markdown](../markdown/README.md)、[actions](../actions/README.md)、[file-card](../file-card/README.md)、[execution-group](../process/execution-group/README.md)、[reasoning-block](../process/reasoning-block/README.md)、[tool-call-card](../process/tool-call-card/README.md)、[sub-agent-card](../process/sub-agent-card/README.md)、[sender](../sender/README.md)、[artifact-card](../artifact-card/README.md)、[message-list](../message-list/README.md)、[processing-indicator](../processing-indicator/README.md)。

同目录测试：[message.test.tsx](message.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
