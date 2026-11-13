# Chat UI 组件目录

每个独立组件均有自己的目录、源码入口和中文 README；复合组件的静态子组件与私有辅助逻辑随主组件维护。公开包导出仍由 `src/index.ts` 提供，copy-in 路径以 `registry.json` 为准。

| 目录 | 用途 |
| --- | --- |
| [layout](layout/README.md) | Layout 页面布局 |
| [chat](chat/README.md) | Chat 对话组合 |
| [sender](sender/README.md) | Sender 输入框 |
| [attachments](attachments/README.md) | Attachments 附件 |
| [suggestion](suggestion/README.md) | Suggestion 快捷指令 |
| [tooltip](tooltip/README.md) | Tooltip 提示 |
| [menu](menu/README.md) | Menu 操作菜单 |
| [message](message/README.md) | Message 单条消息 |
| [message-anchor-rail](message-anchor-rail/README.md) | MessageAnchorRail 回合锚点 |
| [message-skeleton](message-skeleton/README.md) | MessageListSkeleton 消息骨架 |
| [process/execution-group](process/execution-group/README.md) | ExecutionGroup 执行过程组 |
| [process/sub-agent-card](process/sub-agent-card/README.md) | SubAgentCard 子 Agent 卡片 |
| [process/sub-agent-panel](process/sub-agent-panel/README.md) | SubAgentPanel 子 Agent 面板 |
| [process/step](process/step/README.md) | ProcessStep 执行步骤原语 |
| [process/tool-call-card](process/tool-call-card/README.md) | ToolCallCard 工具调用 |
| [process/reasoning-block](process/reasoning-block/README.md) | ReasoningBlock 思考过程 |
| [process/tool-summary](process/tool-summary/README.md) | toolSummary 工具摘要 |
| [markdown](markdown/README.md) | Markdown 富文本 |
| [actions](actions/README.md) | Actions 操作列表 |
| [file-card](file-card/README.md) | FileCard 文件卡片 |
| [code-highlighter](code-highlighter/README.md) | CodeHighlighter 代码高亮 |
| [mermaid](mermaid/README.md) | Mermaid 图表 |
| [agent-header](agent-header/README.md) | AgentHeader 智能体页头 |
| [session-list](session-list/README.md) | SessionList 会话列表 |
| [session-sidebar](session-sidebar/README.md) | SessionSidebar 会话目录 |
| [states](states/README.md) | states 状态组件聚合 |
| [prompts](prompts/README.md) | Prompts 提示集 |
| [plaza](plaza/README.md) | plaza 广场与用量组件聚合 |
| [tool-approval](tool-approval/README.md) | tool-approval 工具审批聚合 |
| [chrome](chrome/README.md) | chrome 页面辅助组件聚合 |
| [artifact-card](artifact-card/README.md) | ArtifactCard 产物卡片 |
| [message-list](message-list/README.md) | MessageList 消息列表 |
| [processing-indicator](processing-indicator/README.md) | ProcessingIndicator 生成提示 |
| [status-indicator](status-indicator/README.md) | StatusIndicator 连接与执行状态 |
| [confirm-dialog](confirm-dialog/README.md) | ConfirmDialog 确认弹窗 |
| [thread-panel](thread-panel/README.md) | ThreadPanel 子线程 |
| [empty-state](empty-state/README.md) | EmptyState 空态 |
| [error-state](error-state/README.md) | ErrorState 错误态 |
| [meter-bar](meter-bar/README.md) | MeterBar 用量条 |
| [activity-heatmap](activity-heatmap/README.md) | ActivityHeatmap 活跃热力图 |
| [category-tabs](category-tabs/README.md) | CategoryTabs 广场分类 |
| [plaza-card](plaza-card/README.md) | PlazaCard 智能体卡片 |
| [tool-approval-card](tool-approval-card/README.md) | ToolApprovalCard 工具审批 |
| [tool-approval-group](tool-approval-group/README.md) | ToolApprovalGroup 工具审批组 |

`process/` 收纳执行过程组件及共享原语；`chrome`、`states`、`plaza`、`tool-approval` 是保留原命令的重导出入口。跨组件的输入组合回归位于 `../../tests/express.test.tsx`。

## 旧 copy-in 项目升级

包方式仍从 `@openagentpack/kit-chat-ui` 导入，导出名称保持一致。已复制源码的项目需要同步
调整业务导入：原 `src/components/kit/message.tsx` 中的 `Message` 改从
`src/components/kit/message/index.tsx` 导入，`MessageList` 改从
`src/components/kit/message-list/index.tsx` 导入；其余组件入口以 registry 和各目录说明为准。

`kit:add` 会复制新目录中的源码，不会删除旧文件或自动合并自定义改动。先核对并合并改动、
更新导入，再清理已不使用的旧文件。
