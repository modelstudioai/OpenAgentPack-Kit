# ADR-0023：用单一 SDK 包承载数据处理与 React 适配

> 现行功能目录与导入入口由 [ADR-0026](./0026-sdk-feature-modules.md) 替代：
> 移除根入口与旧聚合路径，改用功能子入口；单包与 React 可选依赖决策继续有效。

> `@openagentpack/kit-protocol` 后续已由 [ADR-0020](./0020-fold-protocol-into-sdk.md)
> 并入 `@openagentpack/kit-sdk/protocol`；本文保留当时的包边界记录。
>
> Admin 子入口与管理业务归属已由 [ADR-0025](./0025-console-owns-admin-client.md) 替代：
> 业务迁回 Console，通用状态仍由 SDK 提供。

## 背景

`packages/core` 与 `packages/react` 原本是两个包：前者是平台无关运行时，后者是 hooks 层。
两者版本同步、调用方几乎总是一起升级，`react` 包本身只有约 500 行，却额外引入一套
package exports、构建、依赖与文档入口。数据消费者又不需要 React，因此不能简单把两者
合并成一个带 React 的 barrel。

## 决策

1. 新增 `@openagentpack/kit-sdk`，由原 `core` 与 `react` 合并而成；删除
   `@openagentpack/kit-core` 和 `@openagentpack/kit-react`。
2. SDK 的默认根入口只提供数据处理：Stream/Request、Provider、Chat、KitClient、消息转换
   和宿主配置解析。根入口不得导入 React。
3. 能力入口保持显式：
   - `@openagentpack/kit-sdk`
   - `@openagentpack/kit-sdk/stream`
   - `@openagentpack/kit-sdk/request`
   - `@openagentpack/kit-sdk/admin`
   - `@openagentpack/kit-sdk/bailian`
4. React 只作为可选适配层：
   - `@openagentpack/kit-sdk/adapters/react`
   React 是 optional peer dependency；数据入口不依赖 React。
5. `admin` 数据客户端保留在 SDK，但管理端 React hooks 属于 console 应用，放在
   `apps/console/src/lib/admin/`，不从 SDK 导出。
6. 只有 `kit-sdk/bailian` 允许 runtime import 上游 `@openagentpack/sdk` 的浏览器安全
   `session-events` 子路径。

## 理由

- 版本和发布节奏一致，拆包没有形成独立演进价值。
- 单一包可以通过子路径保持数据/React/管理端/百炼的依赖隔离，同时减少 workspace 包数量。
- 默认入口无 React，Node 与 WebView 数据处理消费者不需要安装 React。
- 能力路径比“core 根入口 + react 包”更容易让调用方判断依赖边界。

## 后果

- 所有 `kit-core` / `kit-react` 调用点迁移到 SDK 根入口、能力子入口或 React adapter。
- `elements` 只依赖 `@openagentpack/kit-sdk` 与 `@openagentpack/kit-protocol`。
- tsup 需要多入口和共享 chunk；根入口、React adapter 和 admin 入口分别验证依赖边界。
- dependency-cruiser 用 `sdk-data-no-react`、`sdk-data-no-react-adapter`、
  `sdk-react-no-elements-server`、`sdk-root-no-bailian` 等规则守护。
- Skills API 模块表、生成参考、模板 Vite alias、文档和测试需要同步更新。

## 备选方案

- 保留 `kit-core` + `kit-react`：边界清楚但包数量与版本同步成本更高，且用户仍需要理解两个包。
- 合并成一个所有导出都在根入口的 SDK：实现简单，但 React 与百炼 runtime 会泄漏给数据消费者，
  已否决。
- 把 React adapter 单独发 npm 包：可以提供更强隔离，但与当前“一个 SDK、按能力取子入口”的
  产品定位不一致，暂不采用。
