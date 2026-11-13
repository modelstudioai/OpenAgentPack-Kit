# 研究：@openagentpack/sdk 的会话运行时事实（2026-10-14 live 实测）

## 2026-10-28：实时流封装与首条增量断流

独立临时会话实测确认：同一百炼 BMA `/sessions/:id/events/stream` 会混合以下帧，
并非只返回旧的 `object: "content" + msg_id` 格式：

- 起始：`{ type: "event_start", event: { id, type: "reasoning" | "message" }, object: "message", status: "in_progress" }`。
- 推理：`{ type: "event_delta", event_id, delta: { type: "reasoning_delta", index, reasoning }, object: "content", status: "in_progress" }`。
- 正文：`{ type: "event_delta", event_id, delta: { type: "content_delta", index, content: { type: "text", text } }, object: "content", status: "in_progress" }`。
- 最终快照仍为 `object: "message"`、`status: "completed"`、`id` 与完整 `content`；
  线程、角色与创建时间可在这里补齐。最后独立收到 `session_status=idle`。

本次起始帧只含业务 ID 与类型，不含角色、线程或创建时间；不应按缺失字段猜测子 Agent。
本次没有收到 `event_end`，不能据名称推导或承诺其含义。

已发布 `0.8.0-beta-f1bfc2e-59c5b175-20261028` 会把起始封装输出为未知事件，随后因增量
帧没有旧字段 `msg_id` 抛 `BAILIAN_EVENT_PROTOCOL_ERROR` 并关闭流。这解释了“生成中…”
及“未识别内容：event_start”同时出现，但事后历史仍有完整答案的现象。

该封装兼容修复已随 `0.8.0-beta-66f892f-59c5b175-20261028` 发布并接入 Kit。
脱敏录制见 `apps/server/tests/fixtures/bailian-sse-event-envelope.json`。SDK 负责统一规范化；Kit Gateway
继续只消费 SDK 公开返回值，自建 Provider 仅补充恢复期分片身份追踪。

## 2026-10-14：初始运行时核对

以下结论来自真实 workspace 的 live 验证，
用于约束 `apps/server/src/gateway/sdk.ts` 的实现，避免按文档猜测。

1. **`listRemoteAgents` 返回 `{ data: [...] }`**，元素主键是 `id`（不是 `agent_id`），
   `name` 为展示名。gateway 已按 `data ?? items ?? agents` 与 `id ?? agent_id` 兼容读取。
2. **`createSessionForAgent(ctx, { agent })` 的 `agent` 是 config 声明键，不是远端 id**
   （2026-10-14 二次确认：`UserError: Agent 'agent_example' not found in
   config. Available agents: (none)`； kit 数据面因此改走 REST，见
   `docs/research/bailian-session-file-mount.md`）。
   传远端 id 会报 `Agent '<id>' not found in config`。因此 kit 的会话只能跑在
   **Project 声明的 Agent** 上；远端 only 的 Agent 必须先经 `importResource`（state import）
   采纳进 state 并有对应声明键。这影响了当时 Catalog 的绑定模型；当前绑定合同见 `docs/interfaces.md`。
3. **Bailian 建会话必须有 environment**：声明或 `environmentId` 二选一，否则
   `has no environment declared and --environment was not specified`。
4. **`executePlannedProject(plan)` 不会把 state 落盘**：它写的是 plan 期只读内存 state
   （`InMemoryStateManager.save()` 为空操作）。要持久化必须用
   `syncProjectResourcesWithStateBackend(input, options)`。
5. **`planDestroyProjectContext(ctx)` 收 ctx（同步函数）**，不是 BackendRuntimeInput；
   需包在 `readProjectRuntime(input, ctx => …)` 里。
6. **workspace endpoint 与公网 endpoint 的凭据不通用**：workspace 域名（
   `https://<workspace>.cn-beijing.maas.aliyuncs.com/api/v1/agentstudio`）的 key 在公网
   endpoint 报 `InvalidApiKey`；反之 workspace endpoint 对无权限 key 报
   `Endpoint.AccessDenied`。`bl` CLI 默认走公网 endpoint，live 操作必须显式 `--base-url`。
7. **模型 ID 按 workspace 可用列表校验**：`qwen-plus` 报 `AGENT_010 模型不存在`；
   `bl model list` 可查可用模型（本 workspace 实测含 `qwen3.8-max`）。
8. **删除受引用约束**：Provider 对仍被引用的资源拒绝删除；临时资源的合规清理路径是
   `archiveCloudAgent`（归档），与 AGENTS.md「真实 Cloud 验证」一致。

## 2026-10-19：SSE 候选 SDK 源码与网络 fixture 核对

本节依据 `feat/sdk-sse-adaptation` 候选 SDK 的公开入口与 Kit 网络 fixture，**不是新增 live
实测结论**。包版本号仍为 0.8.0；候选 tarball 哈希和交付边界见对应验收记录。

- `streamSessionEvents` 公开支持 `event_format: "snapshot"`、消息/推理增量、`onReady`、
  `signal` 和恢复选项。Kit 消费 SDK 已归一化的快照，不读 `raw` 或重复映射原始 data。
- Kit 显式传入 sanitizer `{ redact: false, truncate: false }` 保留完整正文与工具参数；
  SDK 原调用的默认脱敏/截断行为保持不变。gateway 仍过滤当前配置的真实凭据，错误只返回
  安全文案，不把 provider 错误原文直接下发。
- 历史读取必须遍历 `page_token`，快照按 `event_id` upsert；`metadata.event_status`
  的 in_progress/completed 标识用于防止完成态倒退。`metadata.artifacts[]` 是 SDK 派生
  产物列表，应接受空数组表示撤回，不应假定它是每帧原生返回字段。
- `tool_approval_request` / `tool_approval_response` 的参数在 data 内容块；主会话
  `session_status` 的 `stop_reason` 对象含 `requires_action`、`pending_batch_id`、
  `pending_call_ids`。Kit 只操作 builtin/mcp 请求，其他工具类型保留只读展示。
- 审批使用 SDK `sendRemoteSessionEvents` 公开入口提交 user 角色事件，由 SDK 包装
  `{ input: [...] }`；线程 ID 来自原审批请求。该通用写入口自身不等待连接，Kit 必须在调用前
  等待共享 pump ready。不能通过发送普通文本来批准，也不能用 interrupt 代替拒绝某个 call。

## 2026-10-27：远端 Agent 分页合同核对

本节依据已安装的 `@openagentpack/sdk@0.8.0-beta-7a98e0f-59c5b175-20261022` 公开类型、
发行包实现与 Kit HTTP fixture，**不是新增 live 实测结论**。

- 公开 `listRemoteAgents(ctx, options)` 的 `AgentListOptions` 接收 `limit`、`page` 和
  `include_archived`，返回 `AgentPage`：`data`、`has_more`、`next_page`。
- Bailian adapter 将 `page` 原样作为 `GET /agents` 的查询游标；`next_page` 是不可解释的
  Provider 游标。SDK 不会自动拉取后续页。已有录制的 `bailian-agents-page.json` 也包含
  `has_more: true` 与 `next_page`，因此只请求 `limit: 100` 不能代表全量目录。
- Kit gateway 使用公开入口逐页读取，按远端 ID 合并跨页重复项；仍返回现有数组合同。
  `has_more` 为真却缺少游标、或游标循环时返回错误，避免静默截断与无限加载。
- `apps/server/tests/sdk-agents.test.ts` 替换网络响应，验证真实 SDK 的 HTTP 查询参数、
  超过 100 条的全量结果、跨页重复项和异常游标；不通过 MockGateway 冒充 Provider 验证。

## 2026-10-27：上架环境列表与会话环境选择

依据同版已安装 SDK 的公开类型和发行实现，`listRemoteEnvironments(ctx, options)` 使用
`EnvironmentListOptions`（`limit`、`page`、`include_archived`），返回 `EnvironmentPage` 的
`data`、`has_more`、`next_page`；元素主键为 `id`，`name` 可省略。Kit 通过公开 SDK
读取所有页，只向管理端返回环境 ID 与名称。HTTP fixture 验证超过 100 条、重复项和异常游标，
这不是新增 live 验证。

Catalog 的可选 `remote_environment_id` 通过现有建会话 REST 窄口子的 `environmentId`
传成 `POST /sessions` 顶层 `environment_id`；不增加 Provider 直连路径。清除覆盖后继续省略
该参数，沿用既有 P1 实测的 Agent 默认环境语义（见 `bailian-session-file-mount.md`）。
本次验证网关请求映射与本地目录持久化，没有创建真实 Cloud Session。

### 2026-11-01：环境详情的只读展示

检查本仓库安装的 `@openagentpack/sdk@0.8.0-beta-66f892f-59c5b175-20261028`：公开入口
`getRemoteEnvironment(ctx, id)` 返回 `CloudEnvironment`，包含 `id/name/description/config`、
`scope/version/type`、创建/更新时间和归档标记。发行包 `index.d.ts` 与 `CloudEnvironmentSchema`
共同确认这些字段；Bailian mapper `toCloudEnvironment` 从响应原样保留 `config`，并将完整响应
放入 `attributes`。Provider 实现通过 `GET /environments/{id}` 读取，ID 在调用前必须限制为
字母、数字、下划线与连字符，避免 SDK 的直接路径拼接被改变。

公开 `EnvironmentDecl.config` 定义运行类型、网络策略（类型、MCP/包管理器放行开关、允许主机）、
apt/pip/npm/go/cargo/gem 六类包及可选初始化脚本。SDK 的 `CloudEnvironment.config` 为 `unknown`，因此 Kit
不能将其整包下发：环境详情逐层白名单投影为 `RemoteEnvironmentDetail.configuration`。
若响应另外包含 `config.environment_variables`，只保留合法变量名，所有值固定返回
`[redacted]`；初始化脚本也只返回该标记，表明已配置，不下发命令正文。其余字符串沿用
远端 Agent 详情的凭据及 URL 认证/查询/片段脱敏规则。缺失或归档返回 404，返回 ID 与请求
不一致时拒绝详情。

对齐 infra 的当前展示范围时，检查了百炼 Managed Agent 控制台环境详情页的
实现与共享类型：
详情展示名称/ID/状态/更新时间等概览、描述、预装包和元数据，网络模块在源码中明确注释隐藏。
`shared.ts` 的 `PACKAGE_MANAGERS` 列出六类包管理器，并将 `remote.package_status` 用于状态展示；
缺失状态不渲染标签，不能推断为就绪。共享 `IEnvironmentPackageStatus` 仅定义 `building` 和 `ready`。
Kit 此次只参考展示信息与字段含义，不复制其组件或依赖；已有网络、作用域、环境变量等详情字段
保留接口兼容，UI 隐藏这些扩展区域。

当前 SDK 的公开 `CloudEnvironment` 没有独立 `package_status` 字段，但其公开 `attributes`
保留 Provider 原响应。Kit 仅从 `attributes.package_status` 提取上述两个已知值，其他值或缺失
均省略，不以通用 `status` 或配置内同名字段回填。SDK 的 `pickStringMetadata` 先过滤非字符串
元数据，Kit 只从公开 `metadata` 再次逐项投影：token/secret/password/credential/api_key/
access_key/private_key/cookie/auth 等敏感键的值隐藏，普通键/值使用共享文本及 URL 脱敏。
因此可以展示用于组织环境的标签，不将原始 metadata 或 attributes 对象下发；自由文本脱敏
覆盖已知模式，不将元数据作为凭据存储或传输渠道。

证据范围为已安装 SDK 源码/类型和替换网络响应的 HTTP 合同测试；本次未访问真实 Cloud，
不代表已验证线上环境详情响应或全部 Provider 配置字段。
