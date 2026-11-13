# ADR-0008：Stream、Request、Provider、Chat 四层运行时

Provider 与 Chat 的消息转换职责已由 [ADR-0009](./0009-provider-message-transform.md)
细化：Provider 定义转换策略，Chat 执行重建并持有消息状态。其余四层和请求合同继续有效。

## 背景

Kit Server 流与原始百炼流已经共享 SSE 文本解析器，但仍各自实现字节读取、取消与资源释放。
传输、后端响应转换和会话编排的公开入口不够清晰，Controller 也被放在 React 包内。
目前没有使用旧六请求回调方式的自建后端接入，调用方可随仓库示例一起迁移。

## 决策

1. 在现有 core 包内建立 Stream → Request → Provider → Chat 四层，不新增 npm 包。
   Stream 管字节解码和 SSE 分帧；Request 管 HTTP；Provider 管后端合同；Chat 管消息状态
   和会话编排。React 只绑定 core 的状态与生命周期。
2. 公开 `createSseStream` 与 `createRequest`，分别提供 `kit-core/stream`、
   `kit-core/request` 子入口和根入口导出。它们可独立于 React、Kit Server 和 SDK 转换器使用。
   Stream 输出原始帧，不解析 JSON 或判断业务完成；Request 默认不重试、不设置超时，
   不添加 Kit 协议头。
3. `createTransport` 保留原 API，组合 Request 与 Kit 帧处理；保留 Kit 协议头、错误格式、
   有效帧超时和结束语义。`KitClient`、五方法 `ChatProvider` 与 `useChat` 的调用方式不变。
4. `createChatController` 与状态、重连、发送和审批编排归入 core 的 chat 模块，从 core
   根入口导出。Provider 每次只管理一次订阅，Controller 统一调度重连；业务写入只发送一次。
5. **本项取代 ADR-0007 的第 3 项请求接入方式**：`createBailianChatProvider` 必需一个
   `RequestClient` 和六项操作配置。每项通过 `buildRequest` 构造路径与 RequestInit，
   通过 `mapResponse` 转换响应，由 Provider 统一调用 Request；不保留旧自由请求回调重载。
   六项操作是原始订阅、历史、发送、中断、审批查询和审批提交。
6. 原始流的 `mapResponse` 返回 `{ response, ready }`，不能先等待 ready 或消费 body。
   Provider 先读取并缓冲实时事件，再等待真实上游 ready、完整历史重建，最后开放发送。
   订阅与历史的取消由 Provider 贯穿构造、鉴权、HTTP、映射和读取；超时或取消关闭迟到响应。
   百炼原始事件累计仍只使用 SDK 的公开 `session-events` 转换器。

## 理由

统一底层读取和请求执行后，可以独立使用流和请求能力，同时在 Provider 保留 Agent 的
持久订阅、历史重建和工具审批合同。现有 Kit 调用不需要迁移；未实际接入的原始工厂配置
一次迁移，避免维护两套请求执行路径。

## 后果

- ADR-0007 其余决策继续有效；事件、就绪、历史顺序、审批和 SDK 默认值保持不变。
- 新通用 Request 不推断后端 URL、JSON 包装、错误正文或 ready；应用身份与错误映射由
  配置提供。Provider 凭据仍在后端。
- 公开入口、英文 Skill、共享可编译示例和中文文档站同步更新。重导出类型按符号身份生成
  一份参考，避免同一合同在离线 Skill 中重复或缺失。
- 独立入口使用浏览器构建检查依赖边界；低层读取与 HTTP 合同分别测试，Provider 与 Chat
  继续保护历史交叉、断流、取消、乐观消息和审批，不在 Hook 层重复协议映射测试。

## 备选方案

- 仅移动文件、保留两套读取和自由请求回调：没有统一资源管理和请求入口，拒绝。
- 把所有模型的单轮 POST 流抽象成统一 Provider：没有相应真实数据面合同，本次不做。
- 让 Request 自动重试写请求：可能重复发送消息或审批，拒绝。
