# ExecutionGroup 执行过程组

将连续思考与工具分片归入同一执行过程，展示状态、数量与耗时。

- `parts` 只接收 reasoning / tool 分片，Message 负责相邻分片分组。
- `messageStreaming` / `ended` 决定生命周期展开与收起，用户仍可手动切换。
- 复用 ReasoningBlock、ToolCallCard 和 ProcessDots。

## Props

下表的类型与必填项以当前源码为准；`—` 表示无固定默认值。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `parts` | `ProcessPart[]` | 是 | — | 同一段连续执行过程中的 reasoning / tool 消息分片。 |
| `createdAt` | `string` | 否 | — | 所属消息的创建时间；分片缺少 startedAt 时作为计时起点。 |
| `messageStreaming` | `boolean` | 否 | `false` | 所属消息仍在流式输出：最后一组保持展开等待后续步骤，已结束的组照常收起。 |
| `ended` | `boolean` | 否 | `false` | 本组之后已出现正文等分片，说明该轮执行已结束，流式期间也收起。 |
| `className` | `string` | 否 | `""` | 追加到容器根节点（details）的工具类。 |

## 导出与使用

本目录维护：ExecutionGroup、isProcessPart、ProcessPart（内部组件与辅助契约）。

这是组件组合使用的内部模块；通过下方 copy-in 条目取得源码，包主入口不单独导出。

```bash
pnpm kit:add execution-group
```

源码入口为 [index.tsx](index.tsx)。copy-in 会保留目录层级并带入 registry 声明的依赖；主题接入见文档站。

组件依赖：[reasoning-block](../reasoning-block/README.md)、[tool-call-card](../tool-call-card/README.md)。

完整用法与参数见[文档站对应页面](../../../../../../apps/storybook/content/docs/components/message.mdx)；全部组件回归运行 `pnpm --filter @openagentpack/kit-chat-ui test`。
