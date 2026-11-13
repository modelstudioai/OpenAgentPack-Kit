# MessageList 消息列表

排列 SDK 消息，提供容器内自动跟随、虚拟滚动、回合锚点、历史分页与多 Agent 尾部入口。

- `messages` 按展示顺序传入；父容器需要有界高度。
- `autoScroll`、`scrollKey`、`active` 管理滚动生命周期。
- `empty`、`pending`、`approvals` 注入空态、首帧前提示和审批内容；历史和文件操作由回调接入。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `messages` | `ChatMessage[]` | 是 | — | 必填，按展示顺序排列的消息；每条消息使用业务 `id` 作为 key |
| `variant` | `"default" \| "workspace"` | 否 | `"default"` | 消息布局；工作区样式将阅读内容居中，并传给内部 Message |
| `onArtifactDownload` | `((fileId: string) => void)` | 否 | — | 传给每个 `Message` 的文件下载回调 |
| `onArtifactOpen` | `((fileId: string, contentType?: string) => void)` | 否 | — | 传给每个 `Message` 的文件预览回调 |
| `onCopy` | `((text: string) => void \| Promise<void>)` | 否 | 浏览器剪贴板 | 传给每个 `Message` 的回答复制能力；失败时抛出异常 |
| `empty` | `ReactNode` | 否 | — | 消息为空时显示的内容 |
| `autoScroll` | `boolean` | 否 | `true` | 自动跟随新增消息与流式内容；用户上滚阅读历史时暂停跟随 |
| `className` | `string` | 否 | — | 添加到列表滚动容器的 Tailwind 工具类 |
| `scrollKey` | `string \| null` | 否 | — | 逻辑会话标识；值变化时重置跟随状态，使新会话恢复滚底 |
| `active` | `boolean` | 否 | `true` | 线程视图保持挂载但隐藏时设 `false`，暂停滚动副作用；再次显示恢复阅读位置 |
| `historyCursor` | `string \| null` | 否 | — | 更早一页成功加载后变化的游标；即使消息合并进同一 Turn，仍可补偿高度保留阅读锚点 |
| `pending` | `boolean` | 否 | `false` | 回合执行中但助手尚未返回首帧时，在列表末尾常驻「生成中…」指示 |
| `pendingLabel` | `string` | 否 | — | 覆盖 pending 指示文案（如发送请求在途时的「发送中…」） |
| `approvals` | `ReactNode` | 否 | — | 当前待审批卡；内嵌到列表末尾，存在时由调用方抑制 pending 指示 |
| `anchorRail` | `boolean` | 否 | `false` | 在列表右缘显示回合锚点栏（Qoder 形态），见回合锚点栏 |
| `multiAgent` | `ChatMultiAgent` | 否 | — | 主流内子 Agent 卡片的实时状态与历史查询来源；省略时不显示子 Agent 分片 |
| `virtualize` | `boolean` | 否 | `true` | 长列表虚拟滚动开关（见虚拟滚动）；`false` 时无论消息数都整体渲染 |
| `skills` | `string[]` | 否 | — | 当前 Agent 的技能名，传给各条 Message 用于还原用户气泡中的技能 chip |

## 导出与使用

本目录维护：MessageList；内部辅助函数 rowOffsets、windowSlice。

包方式接入仍使用公开入口：

```tsx
import { MessageList } from "@openagentpack/kit-chat-ui";
```

```bash
pnpm kit:add message-list
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[message](../message/README.md)、[message-anchor-rail](../message-anchor-rail/README.md)、[processing-indicator](../processing-indicator/README.md)、[sub-agent-card](../process/sub-agent-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../apps/storybook/content/docs/components/general/message-list.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
