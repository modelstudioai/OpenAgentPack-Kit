# packages/sdk — 数据处理与共享协议 SDK

## 不变量

1. **数据入口零 React、零 Node-only API**：各功能数据入口必须能在浏览器、Node、WebView 同跑；
   不得从数据入口反向导入功能模块的 `hooks/`、通用 `src/hooks/` 或 `providers/kit/react/`。
   宿主运行时配置只允许经 `config/index.ts` 的可选链守卫读取；文件选择、保存、剪贴板等
   交互能力属于体验页本地适配（`apps/web/src/lib/host.ts`），不得进入 SDK。
2. **同 ID 是快照更新**：私有有序 ledger 按 `event_id` upsert；相同快照幂等，变化快照替换。
   无 ID 时优先使用传输 cursor 的本地身份，不伪造 Provider ID。累计内容不得再次 append。
3. **控制帧不是 Event**：`reset/ready/done/error/ping/operation` 由流客户端分流。
   `reset` 到 `ready` 期间原子重建 Provider 集合，独立保留乐观消息 overlay。
4. **Turn 边界来自 Provider**：主线程业务状态驱动阶段；`requires_action` 仍在 Turn 中；
   子线程结束不影响主线程；done、网络断开、interrupt 请求成功均不能代替业务完成。
5. **过期回调可丢弃**：会话切换/新一轮使旧 generation 失效，pending 回写不插回旧气泡。
6. **传输 cursor 与业务 ID 分离**：SSE id/ready.cursor 保存为 lastCursor，重连 after 只用它。
   持久订阅的意外 EOF 必须报 retryable，45 秒无有效帧取消读取，所有退出路径释放 reader。
7. **四层单向依赖**：`stream/` 只读字节与分帧；HTTP 请求实现在 `request/index.ts`，
   调用独立的 `stream/` 模块；providers 调用 request，
   解释后端事件与就绪，并提供消息转换策略；chat 持有 ledger/消息并调用策略、编排会话。
   `messages/` 的纯转换不得依赖 Chat、Request、Stream 或后端 Provider。
   低层不得反向依赖会话编排。
   `createSseStream` 的自然 EOF 本身正常结束，是否属于断流由 Provider 判断。
   Stream 与 Request 目录并列，Request 可以调用 Stream，Stream 不得反向依赖 HTTP 请求实现；
   公开入口为 `/stream`，不提供 `/request/stream` 别名。
8. **通用请求没有 Kit 隐式行为**：`createRequest` 不添加协议头、不自动重试或设置超时。
   现有 transport 的 Kit 默认行为在其协议适配层保留。原始百炼 Provider 的六项操作只
   配置请求构造与响应映射，HTTP 统一经注入的 RequestClient。

9. **通用状态与管理业务分离**：`state.ts` 只提供查询代次、写入单飞与快照订阅，`/state` 入口公开
   `createQuery`、`createMutation`、`createObservable` 和 `QuerySnapshot`，不得包含管理路由或
   反向依赖 Request/Provider/Chat。AdminClient、成员用量和 Operation 恢复属于 Console
   （ADR-0025），SDK 不提供 `/admin` 入口，也不得依赖应用代码。业务写入不自动重试。
   `/providers/kit` 的 `streamProtocolFrames` 复用既有协议帧读取，调用方配置路径、身份和协议头。
10. **功能 hooks、通用 hooks 与 Kit Context 分离**：React 只允许出现在
    `chat/sessions/files/agents/usage/auth` 六个功能的 `hooks/`、`src/hooks/` 与
    `src/providers/kit/react/`。功能 hooks 就近绑定对应功能；通用 `src/hooks/` 复用
    订阅、生命周期与查询工具，公开 `/hooks` 只导出 `useIsMobile`。
    通用 hooks 的仓库内依赖仅限自身、`state.ts`、`protocol/` 和 `internal/`，
    不得依赖 KitClient、Context 或业务模块；`useLifecycle`、`useSnapshot`、`usePublicQuery` 保持内部使用。
    Kit Context 归 `providers/kit/react/`，公开 `/providers/kit/react` 只导出
    `KitProvider`、`useKitClient`、`useKitContext`；`useOptionalKitContext` 与 `useResolvedClient` 保持内部使用。
    Kit React 接入的仓库内依赖仅限 Kit 自身，不得引入其他 Provider 或功能流程。
    不保留顶层 `src/react/`，通用 hooks 不汇总各功能 hooks。
    这些 React 模块不得包含新的业务请求逻辑、不得依赖 chat-ui/server。React 仅作为
    optional peer dependency。Console 管理页面的 hooks 属于 Console，不进入 SDK。
11. **`/protocol` 是独立契约子入口**：`src/protocol/` 只放跨层共享的 DTO、zod schema、
    SSE 帧、错误、事件投影与纯协议函数；只通过 `/protocol` 导出，不得依赖 SDK 其他
    子目录、chat-ui 或 apps。对上游 `@openagentpack/sdk` 只允许 type-only 主入口或浏览器
    安全的 `./session-events` 运行时子路径。
12. **协议 schema 是运行时唯一真相**：server 路由校验、console 表单和 OpenAPI 生成必须复用
    `src/protocol` 的 schema，不得在业务应用复制 DTO。仅单一宿主的确认令牌与 Identity
    实现留在 `apps/server`。
13. **OpenAPI 类型是产物**：`src/protocol/generated/openapi-types.ts` 由 `pnpm gen:api-types`
    生成，不手改、不写测试；手写 zod schema 与生成类型分别承担运行时和静态漂移校验。

14. **功能目录与入口一致**：按 ADR-0026 从明确的功能入口导入；不提供 SDK 根入口、
    `/adapters/react`、`/react`、`/request/stream` 或 `/bailian` 兼容别名。纯消息归 `messages/`，
    会话目录归 `sessions/`，附件与产物归 `files/`，额度归 `usage/`，身份归 `auth/`。
    `sessions/load-directory.ts` 只依赖 protocol/internal，Client 只引用这个叶子模块，
    不得反向引用会话工作流；Chat 核心不得反向依赖 Composer 等高层流程。

## 加一个新的事件归并分支时

1. `src/messages/` 增加纯展示转换分支 + `MessagePart` 类型（若需要）；
   Provider 转换只使用当次输入，不缓存跨会话消息，不修改事件；保留 `identity` 与稳定分片 ID。
2. 该目录测试保护展示规则；`src/chat/session-store.test.ts` 保护「回放 + 实时交叉」与
   「同 event_id 累计快照更新」，Controller 测试保护策略注入与会话隔离，不重复叶子映射；
3. `packages/chat-ui` 增加对应渲染（门槛：有真实调用方）。

## 加一个功能 hook 时

1. 先在对应功能目录落无 React 逻辑，复用已有 Request、Chat 与 `state.ts`，并补必要测试；
   Kit 管理业务与页面 hooks 归 Console，不为简单查询再造 Controller；
2. 功能目录内的 `hooks/` 只做订阅、memo 与生命周期，复用 `src/hooks/` 内部工具；
   Kit Client 的 Context 解析复用 `src/providers/kit/react/`，不得带入通用 hooks；
3. 共享 hook 进该功能的 `hooks/index.ts`，出现至少两个真实消费方后才增加公开导出；
   只有单个 app 使用的页面 hook 放回该 app。已公开的组件调用流程由 Web、文档编译示例
   和外部项目共用；不得复制已有组件、Chat 状态机或共享生命周期工具。

## 修改协议子入口时

1. 共享 DTO 或运行时常量放 `src/protocol/`，并更新 `src/protocol/index.ts`；
2. `@openagentpack/kit-sdk/protocol` 的 package export、tsup 入口与 Skills `api-model` 模块表
   必须一致；
3. 新增后端操作同步 `docs/interfaces.md`，并运行 `pnpm gen:openapi`；
4. 只被 server 使用的安全实现放 `apps/server`，不要下沉到共享协议。

## 修改重连/退避时

必须同时改 `docs/protocol.md` 的重连表，并补「静默断流（ping 超时）」与「显式 done」两条
对照测试——不能用发送 done 的 mock 证明自然断流。

## 强制它的闸门

- dependency-cruiser：`sdk-data-no-react`、`sdk-data-no-react-adapter`、
  `sdk-react-no-chat-ui-server`、`sdk-protocol-no-kit-layers`、
  `sdk-protocol-no-upstream-sdk-runtime`；
- SDK 内部单向依赖：`sdk-stream-boundary`、`sdk-request-boundary`、
  `sdk-provider-boundary`、`sdk-state-boundary`、`sdk-chat-boundary`；
- 通用 hooks：`sdk-hooks-boundary` 将仓库内依赖限制为自身、`state.ts`、`protocol/` 与
  `internal/`，禁止带入 KitClient、Context 或业务模块；
- Kit Context：`sdk-kit-react-boundary` 将仓库内依赖限制为 Kit 自身，禁止依赖其他 Provider
  或功能流程；数据 Provider 继续受 `sdk-provider-boundary` 约束；
- 会话目录读取：`sdk-session-directory-loader-boundary` 限制 `sessions/load-directory.ts`
  只依赖协议与内部取消工具，避免 Client 经目录读取反向依赖会话工作流；
- 应用仅消费公开入口：`apps-sdk-public-entries`，禁止导入 SDK 私有源码或构建分片；
- 纯消息转换：`sdk-message-transform-boundary` 禁止展示规则反向依赖编排或网络；
- 百炼入口隔离：`sdk-data-no-bailian` 禁止其他功能入口带入原始百炼转换依赖；
  `messages/` 同样不能加载 SDK 运行时；
- Stream/Request 的读取与请求合同测试；chat 的 store、Controller 和重连测试；
  Provider 的就绪、历史、取消与恢复测试；公开入口的类型与浏览器构建验证。
