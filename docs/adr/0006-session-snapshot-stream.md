# ADR-0006：会话快照流与工具审批使用协议 v2

## 背景

Provider 会在同一 `event_id` 上持续更新正文、工具结果与状态。旧版按 ID 去重并在 idle
关闭订阅，会丢掉快照更新；事件 ID 也无法表达同一事件的不同版本。工具审批需要在等待期间
持续接收状态，而批准或拒绝必须指向 Provider 当前待办。

## 决策

1. 保持 SDK `SessionEvent` 作为唯一事件合同，gateway 显式使用完整 snapshot 模式。
2. Kit 协议升级至 2.x，前后端同步更新，拒绝缺失或不兼容的协议版本。SSE 标准 `id`
   承载 Kit 的 `epoch:sequence` 游标，业务 `event_id` 继续标识 Provider 事件。
3. 会话使用共享持久 pump，先订阅并缓冲实时事件，再合并分页历史，最后发 ready。
   游标失效使用 reset 全量重建，客户端在 ready 时原子发布，保留尚未确认的乐观消息。
4. idle 结束本轮但不结束订阅，requires_action 单独表示审批等待。Provider 与 Kit 两段
   连接分别恢复；恢复期间不自动重发消息或审批。
5. 审批每次只处理一个 batch/call，UI 审查实际参数并显式确认；server 依据当前主会话
   状态、请求和响应事件再次校验后提交。结果不明时先查 Provider 状态再允许人工确认。

## 理由

稳定事件身份、可续传的变更序列与可重建的展示状态承担不同职责。分离三者可保留快照信息，
也能处理进程重启、慢消费者与回放交叉。审批依据 Provider 待办可避免旧卡片重复执行。

## 后果

- 这是一次协调升级，旧前端不能连接 v2 server。协议详见 `docs/protocol.md`。
- 最新事件索引只在内存，Provider 仍是唯一事实源；长会话重建需完整分页读取历史。
- 新 SDK 尚未正式发布时只能用本地候选包验证；发布和干净安装门禁仍是正式交付前置项。
- 新增 ToolApprovalCard 使用 Radix AlertDialog。既有 ConfirmDialog 不能冻结并审查工具
  参数、展示拒绝原因与恢复状态，因而需要独立组件；真实调用方为 web 和 web-experience。

## 备选方案

- 继续用 event_id 去重：无法表达同事件更新，拒绝。
- 在 gateway 再实现原始 SSE 归一化：重复 SDK 职责，拒绝。
- 为工具审批复用 apply 的 plan/token：Provider 的 batch/call 待办不属于 IaC 生命周期，
  保留独立业务校验与 UI 显式确认。
