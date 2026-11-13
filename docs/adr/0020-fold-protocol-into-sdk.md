# ADR-0020：取消独立 protocol 包，契约进入 SDK `/protocol`

## 背景

`@openagentpack/kit-protocol` 同时承载同构 DTO、zod schema、SSE 帧、错误模型、事件投影、
确认令牌、Identity、Skill token 和 OpenAPI 生成类型。它被 server、SDK、console、web、
elements、docs 与 Skills 共同使用。

其中绝大多数内容不是纯类型：

- server 用 zod schema 做请求校验并生成 OpenAPI；
- SDK 用 `KitError`、帧解析、事件归并和审批推导；
- console 用 `decodeFrame`、错误解析和运行时表单 schema；
- elements/web 使用 `PLAZA_CATEGORY_LABELS`、Skill token 解析等纯函数。

SDK 的 `AdminClient` 又覆盖项目、模版、成员和资源等业务操作，因此大部分协议 DTO 同时是
SDK 合同。继续维护独立包只增加构建、依赖与文档成本，没有形成独立演进边界。

## 决策

1. 删除 `@openagentpack/kit-protocol`，共享契约与纯协议能力进入
   `packages/sdk/src/protocol/`，公开为 `@openagentpack/kit-sdk/protocol`。
2. `/protocol` 必须是独立子入口，不从 SDK 根入口自动导出；避免所有数据消费者无条件加载
   zod 和完整管理端 schema。
3. 只被单一宿主使用的实现留在对应层：
   - 确认令牌签发与校验进入 `apps/server/src/services/confirm-token.ts`；
   - `Identity` / `IdentityProvider` / 匿名 cookie 进入 `apps/server/src/identity/types.ts`。
4. 被 server 与 console 同时使用的运行时 schema 不拆到任一业务应用；它们跟随共享契约
   进入 SDK `/protocol`，保持请求校验与 UI 表单校验同源。
5. `apps/server` 将 `@openagentpack/kit-sdk` 提升为 production dependency，因为它现在
   runtime import `/protocol`。

## 理由

- SDK 已成为所有层都会依赖的数据与契约中心，合并可减少一个 workspace 包和构建入口。
- 子入口隔离保留协议能力与 Stream/Request/Chat 数据运行时的边界。
- server-only 安全实现回到 server，避免安全代码被浏览器包暴露。
- 共享 DTO 留在唯一位置，避免 server 与 console 各写一套 schema 后发生漂移。

## 后果

- 全仓 import 从 `@openagentpack/kit-protocol` 机械迁移到
  `@openagentpack/kit-sdk/protocol`。
- SDK 增加 `zod` 依赖、`protocol` tsup 入口、package export 和 API 类型生成脚本。
- dependency-cruiser 改为守护 `packages/sdk/src/protocol`，禁止其依赖 SDK 其他入口、
  elements 或 apps。
- Skills API 模块表把原 protocol 模块映射到 SDK `/protocol`。
- 模板 alias、文档、OpenAPI 生成路径与 lockfile 同步更新。

## 备选方案

- 只把 SDK 使用的声明类型放进 SDK：不可行，协议包含大量运行时 schema 与纯函数。
- 按业务应用拆分 DTO：server 与 console 需要同一套运行时 schema，拆分会复制真相或重新造出
  一个共享业务契约包，已否决。
- 保留独立 protocol 包：边界清楚，但包没有独立演进价值，与当前收敛 workspace 的目标冲突。
