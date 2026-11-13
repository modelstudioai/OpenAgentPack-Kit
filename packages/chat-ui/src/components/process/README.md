# 执行过程组件

这些组件消费公开 SDK 的消息分片和多 Agent 状态，负责执行过程的展示与组件交互。各组件有独立目录；相同的步骤、线程记录和加载反馈继续复用。

- [ExecutionGroup 执行过程组](execution-group/README.md)：`execution-group`。
- [SubAgentCard 子 Agent 卡片](sub-agent-card/README.md)：`sub-agent-card`。
- [SubAgentPanel 子 Agent 面板](sub-agent-panel/README.md)：`sub-agent-panel`。
- [ProcessStep 执行步骤原语](step/README.md)：`process-step`。
- [ToolCallCard 工具调用](tool-call-card/README.md)：`tool-call-card`。
- [ReasoningBlock 思考过程](reasoning-block/README.md)：`reasoning-block`。
- [toolSummary 工具摘要](tool-summary/README.md)：`tool-summary`。

ReasoningBlock、ToolCallCard、SubAgentPanel 可从包主入口导入，其余模块由消息与多 Agent 组件内部组合，或经 registry copy-in 使用。
