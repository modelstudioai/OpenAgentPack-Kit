# SubAgentCard 子 Agent 卡片

在消息流中展示一次子 Agent 派发任务及其执行记录，辅助展示逻辑供 SubAgentPanel 共用。

- `threadId` 在 `multiAgent.threads` 中定位任务；缺少匹配数据时不渲染。
- 历史加载、分页和失败恢复调用 SDK 注入的 multiAgent 回调，组件不自行 fetch。
- 文件打开和下载通过回调透传。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `threadId` | `string` | 是 | — | 本次派发任务对应的线程 ID。 |
| `multiAgent` | `ChatMultiAgent` | 否 | — | SDK 的多 Agent 快照及历史加载回调；缺省或线程不存在时不渲染卡片。 |
| `onArtifactDownload` | `((fileId: string) => void)` | 否 | — | 子线程产物下载回调，参数为文件 ID。 |
| `onArtifactOpen` | `((fileId: string, contentType?: string) => void)` | 否 | — | 子线程产物预览回调，参数为文件 ID 和可选内容类型。 |

## 导出与使用

本目录维护：SubAgentCard；共享 StepRows、ThreadEventStates、formatDuration、isThreadRunning。

这是组件组合使用的内部模块；通过下方 copy-in 条目取得源码，包主入口不单独导出。

```bash
pnpm kit:add sub-agent-card
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[reasoning-block](../reasoning-block/README.md)、[tool-call-card](../tool-call-card/README.md)、[file-card](../../file-card/README.md)。

同目录测试：[sub-agent-card.test.tsx](sub-agent-card.test.tsx)。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/general/sub-agent-panel.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
