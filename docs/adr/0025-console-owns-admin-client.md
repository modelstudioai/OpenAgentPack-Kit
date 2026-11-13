# ADR-0025：Kit 管理业务客户端归属 Console

> 本文中的 SDK 根入口后续由 [ADR-0026](./0026-sdk-feature-modules.md) 替代：
> 通用状态从 `/state`、协议帧读取从 `/providers/kit` 导入；Console 管理业务归属不变。

## 背景

SDK 的 `admin/` 只服务 Kit 管理端，包含固定 `/api/admin/*` 路径、资源批次、模版调试、
成员用量和 Operation 恢复。把这些业务作为公开 SDK 会让外部接入者误以为使用组件必须
实现 Kit 控制面，也使仅由 Console 消费的业务与通用调用状态混在一起。

## 决策

1. 将 AdminClient、成员用量控制器和 Operation 观察器及其业务合同测试迁到
   `apps/console/src/lib/admin/`；管理 hooks 继续位于同目录。
2. 移除 `@openagentpack/kit-sdk/admin` 的 package export、构建入口和分发示例。
   当前 Kit SDK 尚未发布，仓库内调用方一次迁移，不保留管理业务兼容层。
3. 现有查询、写入和可订阅快照实现迁到 `packages/sdk/src/state.ts`，由 SDK 根入口公开
   `createQuery`、`createMutation`、`createObservable` 和 `QuerySnapshot`。只有一份实现，
   SDK 内部与 Console 共用；模块只依赖协议，不包含管理路由或 React。
4. 既有协议帧读取通过 SDK 根入口公开为 `streamProtocolFrames`，复用当前取消、有效帧
   超时、控制帧和 EOF 语义，不复制 SSE 解析器，不新增重连或业务写入重试。
5. 前后端共享 DTO、Schema 留在 SDK `/protocol`；服务端接口、身份、确认闸门与协议不变。
   本次不迁移 `providers/kit`，不修改上游 `@openagentpack/sdk`。

本决策替代 [ADR-0023](./0023-single-sdk-package.md) 第 3、5 条中的 Admin 子入口与业务归属；
单一 SDK 包、数据入口无 React、React 适配层等其他决策继续有效。

## 后果与验证

- Console 通过 SDK 公开入口复用 Request、状态和帧读取；不得导入 SDK 私有源码。
- SDK 不得依赖 Console；通用状态不得反向依赖请求、Provider、会话或应用业务。
- 管理业务测试随实现迁移，通用查询取消、迟到结果隔离与写入单飞测试留在 SDK，避免重复。
- 公开消费者的类型和浏览器构建验证不携带 Console 管理业务或固定管理路由。
- 同步公开 SDK/Skill 文档，并验证成员用量、模版调试与发布进度的代表性管理流程。
