# ADR-0009：Provider 定义消息转换，Chat 持有会话状态

> 纯消息转换的现行位置与导入入口见 [ADR-0026](./0026-sdk-feature-modules.md)：
> 实现在 `messages/`，从 `kit-sdk/messages` 导入；本文的策略与状态所有权继续有效。

## 背景

四层拆分后，`SessionEvent` 到 `ChatMessage` 的展示规则仍由 Chat 直接调用固定实现。
调用方能替换后端接入，却不能在 Provider 上明确提供消息转换策略。SDK 的原始百炼事件
规范化与 Kit 的消息展示归并属于不同职责，需要保留这一区分。

## 决策

1. 本决策细化 ADR-0008 的 Provider / Chat 职责，扩展 ADR-0007 的五方法合同：
   `ChatProvider` 新增可选 `transformMessage?: MessageTransformer`，原有五个方法保持必需。
   SDK 继续负责原始 SSE 到 `SessionEvent`，Provider 定义 `SessionEvent` 到消息的规则，
   Chat 执行转换并持有状态。
2. `MessageTransformInput` 为 `{ messages, event, identity }`；`messages` 是当前线程在
   本次重建中的临时数组，`event` 是最新事件快照，`identity` 是 Chat 分配的稳定事件身份。
   转换可以修改该临时数组或返回替代数组，结果为 `{ messages, artifacts? }`。
   不修改事件，不缓存跨调用或跨会话消息，不执行网络请求。
3. 将默认展示规则及消息类型放入 `providers/messages/`，公开 `transformSessionEvent`。
   默认 Kit Provider 与原始百炼 Provider 都显式提供该策略。省略策略的旧 Provider 或
   直接传入的 KitClient 使用相同默认值；旧 `mergeEvent` 等公开入口保留行为。
4. Chat 继续管理事件 ledger、快照 upsert / reset、线程、乐观消息与对账、执行与审批状态。
   每次从最新 ledger 按线程重建消息并调用策略，返回数组归 Chat 持有。保持稳定消息与分片
   身份；同 ID 快照可以替换或删除内容，不能以永久 append 累加消息。
5. Controller 将 Provider 策略注入 Store；独立 Store 可通过
   `createSessionStore(sessionId, { transformMessage })` 使用同一规则。Controller 仍负责
   重连及发送/停止/审批编排；React 与 UI 的输入输出不变。

## 理由

Provider 能集中定义后端接入和消息展示转换，接近 Ant Design X 的转换策略归属；Chat 保留
状态所有权，避免 Provider 复用时跨会话串消息。继续使用 SDK `SessionEvent` 和现有
`ChatMessage`，无需增加事件模型、修改后端接口或引入多上游服务商抽象。

## 后果

- SDK、Kit Server HTTP/SSE、`useChat`、UI props 与默认运行行为不变。
- 自定义展示规则不能通过删除状态展示项影响真实执行与审批状态；这些状态仍来自事件合同。
- 纯转换受 `core-message-transform-boundary` 约束，不能依赖 Chat 或网络；默认消息转换
  不加载 SDK 运行时，只有原始 SSE 接入使用 SDK 浏览器安全的转换入口。
- API 参考、英文 Skill、共享可编译示例与文档站同步。回归分别保护转换规则、Store 的快照
  重建和 Controller 的策略注入，不在 React 重复协议叶子测试。

## 备选方案

- 将 Store、乐观消息、审批与重连整体移进 Provider：混合转换策略和状态所有权，拒绝。
- 让页面自行把每个 SDK 事件追加成消息：无法统一处理快照替换和撤回，拒绝。
- 为泛化消息输出新增第二套事件或可任意类型的 UI 协议：没有真实合同需求，本次不做。
