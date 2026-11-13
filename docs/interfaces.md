# 接口与 op 对照表

本文件是「后端有哪些操作」的**唯一真相**。新增/修改后端操作的顺序见
`apps/server/AGENTS.md`；`apps/server/openapi.json` 由路由的 zod schema 生成，前端类型
`packages/sdk/src/protocol/generated/openapi-types.ts`（导出为 `OpenApiPaths`）由 openapi.json
生成，两者都不允许手改。改完路由跑 `pnpm gen:openapi`（已串起两步生成）；
`apps/server/tests/openapi.test.ts` 会校验文档可渲染且仓库内 openapi.json 未漂移。

> **生成链路红线**：路由 schema 不得使用 zod-openapi 渲染不了的类型
> （`z.instanceof(File)` → custom、`z.file()` → file），否则**整份** openapi.json 退化为
> `{ message: "Unknown zod object type…" }`。二进制上传用
> `z.any().openapi({ type: "string", format: "binary" })` 描述，运行时校验写在 handler 内。

状态图例：✅ 已实现并有测试 · 🚧 待补 · 📅 后续

## 通用约定

- 所有响应 `{ data }` 或 `{ error: { code, message, details? } }`；分页统一
  `{ data, next_page_token }`，cursor 是**不透明字符串**，不得转成数字页码。
- 数据面 `/api/kit/*` 走终端用户 Identity（`subjectId`）；控制面 `/api/admin/*` 走
  `ADMIN_TOKEN` bearer（v1）。登录入口公开，其他业务 API 默认要求成员令牌或已配置的
  可信 JWT。只有显式 `KIT_AUTH_MODE=anonymous` 才允许无 Bearer 的匿名身份；无效 Bearer
  一律 401，不回落匿名。`member_` 前缀仅允许本地成员会话使用，外部 JWT sub 不可使用。
- Session 消息发送、stream 与审批 GET/POST 要求 `x-kit-protocol-version: 2.0.0`（接受 2.x），
  缺失或混版返回 409。`after` 是 Kit 传输游标，与 Provider `event_id/after_id` 分离。
- 时间戳一律 ISO-8601 UTC。ID 一律透传 Provider 原值，kit 不自造 ID（除 catalog /
  operation / plan 这类 kit 自有对象）。
- **管理端身份与角色**：`ADMIN_TOKEN`（恒为 `admin`）+ `KIT_ADMIN_TOKENS="<token>:<role>,…"`
  （role ∈ `admin|auditor`）。`auditor` 是**只读**角色：只能 `GET/HEAD/OPTIONS`，任何写方法
  在中间件层就被拒（`403 forbidden`），因此新增路由不可能漏掉这条规则。审计里记的主体是
  令牌指纹 `admin:<role>:<sha256前8位>`，不落令牌原文。
  Console 按规范化 `apiBaseUrl`（含路径前缀）保存令牌；配置或 `?api=` 改变目标时，
  不得向新后端发送其他目标的已存令牌。
- **限流**：按 `subjectId` 的令牌桶（`KIT_RATE_LIMIT_RPS` 默认 20、`KIT_RATE_LIMIT_BURST`
  默认 60，`RPS=0` 关闭）；超限 `429 rate_limited`（`retryable: true`）并带 `retry-after` 秒数。
  公开路由（`/api/config`）无身份，不参与限流。
- **请求体上限**：JSON 走 `KIT_BODY_LIMIT_BYTES`（默认 1 MiB），上传走 `KIT_UPLOAD_MAX_BYTES`
  （默认 20 MiB）；超限 `413` + `invalid_request`。
- **附件扫描闸门**：建会话携带 `files` 或发消息携带 `attachments` 时，服务端有界等待
  provider 扫描完成（`KIT_FILE_SCAN_TIMEOUT_MS`，默认 20s）；未就绪返回 `409 conflict`
  （`retryable: true`），客户端按 `retryable` 退避重试，而不是把 provider 原始报错甩给用户。
- **指标**：`GET /api/admin/metrics` 输出 Prometheus 文本；label 只有路由模板/方法/状态码，
  禁止把 id、令牌、事件正文或用户输入写进 label。
- **跨源**：`KIT_CORS_ORIGINS` 支持 `http://127.0.0.1:*` 形式的 loopback 端口通配，
  用于本地静态服务的动态端口，默认值已含该条；通配写在非 loopback 域名上会被忽略。
  响应暴露 `Content-Disposition` 和 `Retry-After`，允许跨源客户端读取下载文件名和重试时间。

## 公开

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `health` | `GET /healthz` | 存活与 gateway 模式（`sdk` / `mock`） | ✅ |
| `config.get` | `GET /api/config` | 运行时公开配置：`apiBaseUrl`、`protocolVersion`、`auth: {mode: member\|anonymous, passwordLogin: true}`、能力开关、`branding: {productName, logoUrl?}`。品牌由管理端保存，上传 Logo 的 `logoUrl` 指向 `/api/branding/logo?v=<hash>`；员工端启动读取本接口，不依赖构建时环境变量。**所有端启动必读，禁止假设同源** | ✅ |
| `branding.logo` | `GET /api/branding/logo` | 公开读取管理端上传的 Logo 二进制；响应 Content-Type 为图片类型，CSP sandbox 隔离同源权限并禁止脚本及外部资源（允许 SVG 内联样式），设置 nosniff；hash 查询参数用于缓存破坏，长缓存 immutable；不存在返回 404；不参与身份与限流 | ✅ |
| `auth.login` | `POST /api/kit/auth/login` | `{username,password}` → `{data:{access_token,token_type: Bearer,expires_at,member}}`；统一错误凭据 401，独立登录限流 429，禁止缓存 | ✅ |
| `auth.logout` | `POST /api/kit/auth/logout` | 撤销当前本地成员 Bearer，幂等 204；令牌失效时也可退出，不接受管理员令牌代替成员身份 | ✅ |

## 成员认证

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `auth.me` | `GET /api/kit/auth/me` | 恢复当前身份：`{data:{identity,member?,expires_at?}}`；成员令牌返回公开成员资料与有效期，外部 JWT 返回 identity；无效 / 过期 / 已撤销令牌 401 | ✅ |

- 默认 `KIT_AUTH_MODE=member`；体验页配置缺少 auth 时也按必须登录处理。
- 用户名 trim 后忽略大小写；密码不 trim。登录未知账号与错误密码使用相同错误，错误消息、
  审计和日志不包含输入密码或令牌。登录独立限制全局 / 用户名尝试频率及并发密码派生数量。
- 令牌固定 8 小时有效，无自动续期；数据库仅存 SHA-256 哈希。请求通过 Authorization
  携带，跨域无需成员 cookie。退出撤销当前令牌并关闭其 SSE，不影响其他独立登录。
- 默认体验页按完整 apiBaseUrl（含路径前缀）隔离 sessionStorage，只存令牌与到期时间。
  刷新通过 me 验证后挂载页面；恢复网络失败不放行。退出、过期或 401 清理旧请求、SSE、
  消息、草稿、附件与用量；退出撤销失败时提供重试，不切换到另一个成员继续使用。
- 本地成员 `identity.subjectId = member.member_id`；已有匿名数据不会自动迁移。
  自建后端身份仍由调用方提供，本地成员接口不会改变自定义 ChatProvider 合同。
- 升级旧数据库时，迁移 `006_legacy_file_ownership` 从已有 Session 的 `files_json` 恢复文件
  归属：仅采纳在所有历史挂载中指向唯一 subject 的文件，保留已有上传记录。原身份可继续
  下载与挂载；跨身份歧义、无挂载记录的旧文件仍拒绝访问，须重新上传。这不合并匿名与成员身份。

## 数据面 `/api/kit/*`（终端用户）

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `agents.list` | `GET /api/kit/agents` | 已上架 Catalog Entry 列表（slug/展示名/图标/描述/开场白/示例问题/主题/能力） | ✅ |
| `agents.get` | `GET /api/kit/agents/:slug` | 单个已上架条目；未上架 404；懒读取远端 Agent 资源投影 `resources`（tools/skills/mcp_servers，仅成员侧展示），Provider 失败时省略该字段；目录记忆配置投影 `memory_stores`（仅名称/描述，无库 ID、权限或条目），未配置或读取失败时省略 | ✅ |
| `sessions.agents.list` | `GET /api/kit/session-agents` | 当前 subjectId 的全部未归档体验会话关联的智能体 slug，返回 `{data:string[]}`；按各组最近活动倒序，不受会话单页数量限制，不依赖 Catalog 上架状态，不包含其他身份、调试会话或仅有归档的组；只读本地索引，不查询 Provider | ✅ |
| `sessions.list` | `GET /api/kit/sessions` | 当前 subjectId 的体验会话摘要，`?agent_slug=&limit=&page_token=&include_archived=&q=`；按 `COALESCE(last_event_at,created_at)`、`session_id` 双字段倒序分页，返回 `{data,next_page_token}`。`limit` 为 1..200（缺省 50），`include_archived=false` 在分页前排除归档，缺省仍包含归档。`q` 为 1..100 字符关键词，在分页前按标题、智能体 slug 及当前 Catalog 展示名过滤，只覆盖本人体验会话索引。游标绑定身份、智能体筛选、归档条件及关键词，条件不匹配或游标无效返回 400；最后一页返回 null。仅查询运营索引，不读取事件正文。`last_event_at` 由发消息推进，订阅水合与归档仅同步状态，点开回看不改排序；运行态由完整事件账本和受理中的 pending turn 共同投影，重复的旧 idle 不得结束新回合。共享泵在订阅者离开后继续跟踪 running 回合到终态；仅对没有上游泵的存量 running 行在 2 分钟后兜底对账，详情 idle 仍需历史投影确认非 running，同一会话 60 秒内不重复探测，失败保留原值，最终一致 | ✅ |
| `sessions.create` | `POST /api/kit/sessions` | `{ agent_slug, title?, files? }` → 建 Provider Session 并落本地索引；`files` 为已上传附件，服务层在建会话后经运行时挂载进 sandbox（创建载荷不带文件——创建时 file_resource 回显成功但沙箱不物化，实测 2026-11-03；mount_path 省略时按 `/mnt/session/uploads/<文件名>` 解析，重名自动 `-2`；挂载失败回滚已挂载并删除刚建会话），详情回显 `files`；已有会话追加挂载走 `sessions.messages.send` 的 `attachments`。provider wire 形状与沙箱物化矩阵见 `docs/research/bailian-session-file-mount.md` | ✅ |
| `sessions.get` | `GET /api/kit/sessions/:sessionId` | 会话详情 + 归属校验（非本人 404，不泄露存在性）；含挂载的 `files`（本地索引为权威，运行时挂载 provider 不回显），Provider 返回时含累计 `usage` 与秒单位 `stats`，缺失不补零 | ✅ |
| `sessions.update` | `PATCH /api/kit/sessions/:sessionId` | 改标题（本地索引 + Provider 同步） | ✅ |
| `sessions.plan` | `POST /api/kit/sessions/:sessionId/plan` | `{ action: archive\|delete }` → `{ plan_id, confirm_token, destructive, expires_at, diff }`；会话级破坏性动作的第一段 | ✅ |
| `sessions.archive` | `POST /api/kit/sessions/:sessionId/archive` | `{ plan_id, confirm_token }` → 归档；空令牌 400、伪造/重放令牌 428 | ✅ |
| `sessions.delete` | `DELETE /api/kit/sessions/:sessionId` | `{ plan_id, confirm_token }` → 删除 Provider 会话 + 本地索引；同上闸门。真实本地成员的 experience 会话必须先确认执行结束并持久化用量快照，失败 409 提示重试；已删除快照继续计入成员统计 | ✅ |
| `sessions.messages.send` | `POST /api/kit/sessions/:sessionId/messages` | `{ text, skills?, client_message_id?, attachments? }` → 发送并触发流式。`skills` 为技能 token 授权名单（ADR-0016，从正文输入标记派生）：发送服务层在 mock/live 共用路径上把名单内技能名的 `/name` 输入标记转为协议 token `[使用 Skill:name]`（未授权名原样保留，无 skills 不改写），详见 `docs/protocol.md` 技能 token 节。`attachments` 非空时先经 SDK 公开 API 运行时挂载进 sandbox 再发送（发送失败自动卸载回滚；未就绪 409 `conflict` 可重试；非本人上传 404），详见 `docs/protocol.md`。订阅就绪及工具审批校验后，本地成员检查月度与日度 Token/执行时长，超限 403 `quota_exceeded`（月度 details 含 metric/month/limit/used/remaining/reset_at，日度含 period:"day"/day/reset_at，其余同），指标不可确认或上一轮未结束返回 409。随后记录 1 Turn，匿名/JWT 仍检查 Credits；前置拒绝不写账本，成功受理的 `client_message_id` 重放不重复发送或计量 | ✅ |
| `sessions.interrupt` | `POST /api/kit/sessions/:sessionId/interrupt` | 中断当前 Turn | ✅ |
| `sessions.events.list` | `GET /api/kit/sessions/:sessionId/events` | 完整快照历史分页，`?after_id=&limit=&page_token=` | ✅ |
| `sessions.threads.list` | `GET /api/kit/sessions/:sessionId/threads` | 子 Agent 线程摘要分页，`?limit=&page_token=`；校验本人 experience Session，SDK 查询并按绑定版本补充 Agent 名称 | ✅ |
| `sessions.threads.events` | `GET /api/kit/sessions/:sessionId/threads/:threadId/events` | 子 Agent 完整快照事件分页，最新在前；`?limit=&page_token=`；仅接受 `sthr_*`，与 Session 一起交给 Provider 校验 | ✅ |
| `sessions.stream` | `GET /api/kit/sessions/:sessionId/stream` | 协议 2.0 持久 SSE，`?after=` 为传输游标；帧定义见 `docs/protocol.md` | ✅ |
| `sessions.tool-approvals.list` | `GET /api/kit/sessions/:sessionId/tool-approvals` | 当前 requires_action、批次、待办调用与请求详情；归属检查，历史请求不自动激活 | ✅ |
| `sessions.tool-approvals.respond` | `POST /api/kit/sessions/:sessionId/tool-approvals` | `{ batch_id, call_id, result: allow/deny, deny_message? }`；单项决策，原因最多 200 字符；实时校验，过期/重复 409。本地成员 allow 还检查该轮开始月的限额，deny 不受额度阻止；提交成功不等于执行成功 | ✅ |
| `files.upload` | `POST /api/kit/files` | multipart（字段名 `file`）上传附件 → `{ file_id, filename, size }`；记录当前 subjectId，只有本人可挂载；黑名单扩展名（`.mjs`，实测 provider 415 拒绝）返回 400 `invalid_request`；超过 `KIT_UPLOAD_MAX_BYTES`（默认 20 MiB）返回 413 | ✅ |
| `files.status` | `GET /api/kit/files/:fileId` | 本人上传附件的安全扫描状态 → `{ file_id, status, available }`（`checking → available`，实测 15~20s）；越权 / 非本人上传 404。客户端在上传后轮询到 `available` 再发送，服务端发送前的扫描闸门保留为兜底 | ✅ |
| `files.download` | `GET /api/kit/files/:fileId/download` | 鉴权代理下载：本人上传文件可直接下载；Artifact 须带 `?session_id=`，验证本人 Session 的 Provider 历史确有该文件；越权 / 无归属证据 404，屏蔽预签名 URL | ✅ |
| `plaza.get` | `GET /api/kit/plaza` | 广场视图：已上架条目 + 每条目 `stats{mine,turns_30d,last_used_at}` + 顶层 `featured[]`/`popular[]`/`categories[]`；`?category=&q=` 过滤；popular 无用量数据时回退 ordering | ✅ |
| `quota.get` | `GET /api/kit/quota` | 匿名/JWT 的兼容月度 Credits；本地成员只返回 Turn 运营计数，Credits 限额为不限量，应使用 `usageLimits.get` 查询有效限额；`?days=`（1..400，缺省 30）指定 `daily` 逐日 Turns 窗口（年维度热力一次查询近 53 周） | ✅ |
| `usageLimits.get` | `GET /api/kit/usage-limits` | 当前本地成员 `{data: MemberUsageLimitView}`（含 `daily` 逐日增量供每日用量热力及 `day_state` 今日限额状态；`?days=`（1..400，缺省 30）指定 daily 窗口长度，含今天 UTC 零值补全）；匿名/JWT 返回 `{data:null}`，失败不得解释为非成员；禁止缓存 | ✅ |
| `quota.requests.create` | `POST /api/kit/quota/requests` | 提交提额申请 `{requested_credits, reason?}`；已有 pending 时 409 `request_pending` | ✅ |
| `quota.requests.list` | `GET /api/kit/quota/requests` | 我的申请历史 | ✅ |

## 控制面 `/api/admin/*`（管理端）

### 已退役的目录接口

/api/admin/projects/** 及按项目声明创建调试 Session 的接口已移除（ADR-0018），认证后的访问返回 404。
SDK/CLI 自身的目录能力不受影响；Kit 只提供下面的 YAML 批次接口。

### 一次性资源批次

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `resourceDrafts.active` | `GET /api/admin/resource-drafts/active` | 当前管理员未完成或待清理批次，返回 `{data:ResourceDraftView\|null}`；清理完成后为 null，失败与结果未知时仍返回同一批次 | ✅ |
| `resourceDrafts.create` | `POST /api/admin/resource-drafts` | 幂等获取或创建本人唯一未完成批次，返回 `{data:ResourceDraftView}`（200）。新建空 YAML 声明与 SDK state，不创建源码目录，也不复制主项目声明或旧 state；旧目录记录只归档，不进入活动批次；仅管理员可写 | ✅ |
| `resourceDrafts.get` | `GET /api/admin/resource-drafts/:draftId` | 获取本人批次、已持久化资源绑定与服务端决定的 recovery_action（replan/read_result/finalize/none）；已发布且清理完成后仍可读回执，非本人返回 404；不返回本地路径、源码、SDK state 或凭据 | ✅ |
| `resourceDrafts.finalize` | `POST /api/admin/resource-drafts/:draftId/finalize` | 仅根据已持久化且批次 revision 匹配的 SDK 成功证明补全回执或重试本地清理；不再次执行 Provider 发布。缺成功凭证或结果未知为 409，不能仅凭 state 中已有 ID 标记成功 | ✅ |
| `resourceDrafts.discard` | `POST /api/admin/resource-drafts/:draftId/discard` | 退出向导丢弃本人尚未开始远端发布的批次，返回 `{data:{discarded:boolean}}`。等待在途本地调用结束、作废计划并释放暂存，安全清理本批数据库声明与独立上传暂存后删除草稿记录；不调用 Provider 删除。缺失/已删除或 published 返回 false；非本人 404；发布执行中或结果不明为 409 且 `error.details.reason=publication_unresolved`。本地清理失败返回错误并保留可重试记录；重复旧 ID 请求不影响新批次 | ✅ |


以下资源接口以 `:name` 表示已登记批次 ID，均先核验管理员归属；配置输入复用现有 DTO，
输出去除源码路径字段。新前端使用 `AdminClient.draftResources`，没有 Build 或源码版本操作。

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `resourceDrafts.resources.overview` | `GET /api/admin/resource-drafts/:name/resources` | 修订号与待发布资源摘要，不返回服务器路径 | ✅ |
| `resourceDrafts.resources.declarations.list` | `GET /api/admin/resource-drafts/:name/resources/declarations` | 声明清单；ResourceDraftDeclaration 不含 source_path/owner_agent | ✅ |
| `resourceDrafts.resources.declarations.get` | `GET /api/admin/resource-drafts/:name/resources/declarations/:type/:id` | 单个安全声明；Vault 值不回显 | ✅ |
| `resourceDrafts.resources.declarations.preview` | `POST /api/admin/resource-drafts/:name/resources/declarations/:type/:id/preview` | 沿用 DeclarationPreviewInput，SDK 校验修改或删除 | ✅ |
| `resourceDrafts.resources.declarations.put` | `PUT /api/admin/resource-drafts/:name/resources/declarations/:type/:id` | 沿用 DeclarationWrite；base_revision 乐观锁，成功递增当前修订号；递归拒绝明文凭据，拒绝不改变声明、revision 或已有计划 | ✅ |
| `resourceDrafts.resources.declarations.delete` | `DELETE /api/admin/resource-drafts/:name/resources/declarations/:type/:id` | 沿用 DeclarationDelete；拒绝有损引用配置 | ✅ |
| `resourceDrafts.resources.agents.options` | `GET /api/admin/resource-drafts/:name/resources/agent-options` | 本批共享 Skill 和可复用官方 MCP | ✅ |
| `resourceDrafts.resources.agents.create` | `POST /api/admin/resource-drafts/:name/resources/agents` | 沿用 ProjectAgentCreateInput，返回 ResourceDraftAgentCreateResult；只写 YAML | ✅ |
| `resourceDrafts.resources.environments.create` | `POST /api/admin/resource-drafts/:name/resources/environments` | 沿用 ProjectEnvironmentCreateInput，返回 ResourceDraftEnvironmentCreateResult | ✅ |
| `resourceDrafts.resources.vaults.create` | `POST /api/admin/resource-drafts/:name/resources/vaults` | 沿用 ProjectVaultCreateInput，返回 ResourceDraftVaultCreateResult；值仅保留批次内存 | ✅ |
| `resourceDrafts.resources.memoryStores.create` | `POST /api/admin/resource-drafts/:name/resources/memory-stores` | 沿用 ProjectMemoryStoreCreateInput，返回 ResourceDraftMemoryStoreCreateResult | ✅ |
| `resourceDrafts.resources.memoryStores.get` | `GET /api/admin/resource-drafts/:name/resources/memory-stores/:storeId` | 本批记忆初始化配置，正文按字面量解析 | ✅ |
| `resourceDrafts.resources.bindings.list` | `GET /api/admin/resource-drafts/:name/resources/resource-bindings` | 从 SDK state 投影当前绑定，关闭后读取最小回执 | ✅ |
| `resourceDrafts.resources.bindings.resolve` | `POST /api/admin/resource-drafts/:name/resources/resource-bindings/resolve` | 按显式声明键解析绑定；先验证全部声明存在（缺失 404），仅检查所选项是否已发布且绑定完整（否则 409），不被未选资源阻塞；不从历史回执生成 state | ✅ |
| `resourceDrafts.resources.files.stage` | `POST /api/admin/resource-drafts/:name/resources/file-uploads` | multipart 暂存；沿用上传大小、归属和 TTL 限制 | ✅ |
| `resourceDrafts.resources.files.discard` | `DELETE /api/admin/resource-drafts/:name/resources/file-uploads/:uploadId` | 释放本批未提交上传 | ✅ |
| `resourceDrafts.resources.files.preview` | `POST /api/admin/resource-drafts/:name/resources/file-uploads/preview` | 预览新增文件声明 | ✅ |
| `resourceDrafts.resources.files.commit` | `POST /api/admin/resource-drafts/:name/resources/file-uploads/commit` | 受控暂存文件与声明一起提交；revision 变化使旧 Plan 失效 | ✅ |
| `resourceDrafts.resources.skills.stage` | `POST /api/admin/resource-drafts/:name/resources/skill-uploads` | 校验 ZIP/SKILL.md，保留 SDK 来源检查 | ✅ |
| `resourceDrafts.resources.skills.discard` | `DELETE /api/admin/resource-drafts/:name/resources/skill-uploads/:uploadId` | 释放本批未提交 Skill | ✅ |
| `resourceDrafts.resources.skills.preview` | `POST /api/admin/resource-drafts/:name/resources/skill-uploads/preview` | 预览新增 Skill 声明 | ✅ |
| `resourceDrafts.resources.skills.commit` | `POST /api/admin/resource-drafts/:name/resources/skill-uploads/commit` | 提交 Skill 暂存及 YAML 引用；未绑定 Agent 时阻断发布 | ✅ |
| `resourceDrafts.resources.validate` | `POST /api/admin/resource-drafts/:name/resources/validate` | SDK 离线校验与引用检查，不调用远端写操作 | ✅ |
| `resourceDrafts.resources.plan` | `POST /api/admin/resource-drafts/:name/resources/plan` | 只接受 publish；差异来自 SDK，绑定 revision/YAML/上传清单和 SDK 计划；声明与 state 都为空时返回 SDK 只读空计划，前端直接进入预览；声明为空但 state 非空则 409，不规划删除 | ✅ |
| `resourceDrafts.resources.publish` | `POST /api/admin/resource-drafts/:name/resources/publish` | 必须带 plan_id/confirm_token；返回 Operation，执行前重新核对已确认计划 | ✅ |

`ResourceDraftView` 包含 `draft_id/project_name/status/resources/cleanup_pending/operation_id?/created_at/updated_at`；
`project_name` 等于 `draft_id`，`status` 为 `draft/publishing/published/failed`。`resources` 沿用五类运行时
`ProjectResourceBinding`，仅投影本地声明键、远端 ID 与实际版本；Agent 必须有具体正整数版本。
内部成功回执另保存已发布 Skill 的 ID 及可证明的版本，SDK 未给版本时不推测。

向导在 `active/create/discard` 上通过 `x-kit-draft-key` 请求头发送浏览器持有的随机 UUID 清理凭证。
服务端创建时只存 SHA-256 哈希；创建重试与 discard 必须匹配，带此头的 active 读取也先校验。
缺失或不匹配返回 `409` 且 `error.details.reason=draft_owned_elsewhere`，不能接管或删除原批次；
已不存在的 discard 仍幂等返回 false。凭证不进入 URL、回执和审计正文，CORS 允许该请求头。
同源页面继续用 Web Lock 互斥，不同浏览器/来源通过服务端凭证隔离。无此头的 active/get 保留管理员读取能力；
存量未登记凭证的 YAML 批次仅允许无此头的 API 显式 create/discard，新向导不能自动清理这些批次。

新批次通过 YAML gateway 调用 SDK 公开对象解析、资源 scope、Plan 与执行入口，不创建 SDK 目录项目。
Kit 只保留当前声明，修订号不等于模版历史或 Agent 版本。SDK state 检查点、YAML 和成功证明保存在
SQLite，SDK 管理 state 语义；独立上传暂存受路径边界、哈希和批次互斥保护。Provider 凭据显式传入，
Vault 值只留在批次内存，声明仅保存随机引用；不写全局环境变量。

编辑与编辑预览在 SDK 规范化前递归检查字段和正文，敏感字段仅允许空值或环境变量引用，
不接受明文认证值；Vault 的受保护引用及 HTTP 注入开关保留原语义。读取历史声明时对敏感字段
及凭据式文本脱敏并记录 read_only_paths，不改写原存储；Agent 描述与指令的读取仍保留原文。
安全校验拒绝不回显输入、不递增 revision，也不作废此前有效计划。

Plan/确认令牌绑定批次、主体、当前修订号与声明及上传内容。执行前核对 SDK 计划后才写远端，
只管理本批新内容；导入未修改的远端资源继续按引用使用。SDK 完整成功后先保存独立成功证明，
再验证六类绑定、保存最小回执并清理配置、state 和上传；Agent 必须有具体正整数版本。
部分成功或结果不明保留现场并禁止重发，重启不自动继续执行；只有明确未写远端的失败可以重新 Plan。
回执持久化后清理失败使用 published/cleanup_pending=true，只重试收尾，不重新发布或重建声明。

旧目录批次由迁移原样归档至 kit_retired_directory_drafts，原目录保留；旧批次不再通过运行接口读取或执行。
迁移释放活动名额，不改现有 YAML 批次。成功回执不得回填后续批次的 SDK state。

### 全局配置

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.branding.get` | `GET /api/admin/branding` | 返回员工端品牌 `{productName, logoUrl?, updatedAt, updatedBy?}`；admin/auditor 可读 | ✅ |
| `admin.branding.update` | `PUT /api/admin/branding` | 保存 `{productName, logoUrl?}`；名称 trim 后 1–60 字。`logoUrl` 为字符串时切换到本站路径/http(s) URL 并清除上传文件；为 `null` 时清除 Logo；省略时保持现有 Logo。auditor 禁写；保存后写入审计并立即反映到 `GET /api/config` | ✅ |
| `admin.branding.logo` | `POST /api/admin/branding/logo` | multipart `file`；仅接受 PNG/JPEG/WebP/SVG，最大 512KB；存储二进制并清除外部 URL，返回 `BrandingView`，`logoUrl` 指向 `/api/branding/logo?v=<hash>`；auditor 禁写并写审计 | ✅ |

### 管理员调试

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.identity` | `GET /api/admin/identity` | 当前 role/subject，供只读 UI 与草稿作用域使用；不返回令牌 | ✅ |
| `debug.sessions.createTemplate` | `POST /api/admin/debug/sessions` | `CreateTemplateDebugSessionRequest`：`{remote_agent_id,agent_version?,remote_environment_id?,title?,files?,memory_stores?,vault_ids?}`；`agent_version` 为显式绑定的正整数，省略使用最新版本；环境省略时使用智能体默认环境，不查询环境目录、不传 Provider 环境覆盖；服务端重新校验远端目标及显式资源元数据后按所选版本建会话，来源为 template，不需要项目声明或 Catalog；文件最多 10、记忆库最多 8、密钥库最多 10，只挂载 ID 与配置，不读取凭据 | ✅ |
| `debug.sessions.get` | `GET /api/admin/debug/sessions/:sessionId` | 归属校验后返回详情及附件；source 区分 project/template，项目来源包含声明键及源码 revision/source_dirty，模版来源包含远端环境、记忆与密钥库挂载配置；均含远端 Agent ID | ✅ |
| `debug.sessions.messages.send` | `POST /api/admin/debug/sessions/:sessionId/messages` | 同 SendMessageRequest；复用就绪、幂等发送及审批检查，不扣员工 Credits；中途附件 400 | ✅ |
| `debug.sessions.stream` | `GET /api/admin/debug/sessions/:sessionId/stream` | 复用共享 SSE pump、Kit v2 reset/ready/event 与 after 续传 | ✅ |
| `debug.sessions.events` | `GET /api/admin/debug/sessions/:sessionId/events` | Provider 历史分页，支持 after_id/page_token/limit；正文不落库 | ✅ |
| `debug.sessions.threads` | `GET /api/admin/debug/sessions/:sessionId/threads` | 当前管理员所属调试会话的子 Agent 线程分页，支持 page_token/limit；与体验端共享 Provider 线程合同 | ✅ |
| `debug.sessions.threadEvents` | `GET /api/admin/debug/sessions/:sessionId/threads/:threadId/events` | 当前管理员所属调试会话的子线程完整事件快照分页，最新在前；threadId 仅接受 sthr_*，不落库，客户端转为 ChatProvider 所需正序 | ✅ |
| `debug.sessions.interrupt` | `POST /api/admin/debug/sessions/:sessionId/interrupt` | 停止当前执行，不推断已完成 | ✅ |
| `debug.sessions.tool-approvals.list` / `.respond` | `GET / POST /api/admin/debug/sessions/:sessionId/tool-approvals` | 复用现有审批合同与实时校验；POST 只提交一次 | ✅ |
| `debug.sessions.plan` | `POST /api/admin/debug/sessions/:sessionId/plan` | `{action:delete}` → 一次性确认令牌与删除影响 | ✅ |
| `debug.sessions.delete` | `DELETE /api/admin/debug/sessions/:sessionId` | `{plan_id,confirm_token}` → 删除远端会话与本地索引 | ✅ |
| `debug.files.upload` | `POST /api/admin/debug/files` | multipart file，沿用上传上限/扫描规则，归属当前管理员和 admin_debug 用途 | ✅ |
| `debug.files.download` | `GET /api/admin/debug/files/:fileId/download` | 本人同用途上传或本人调试 Session 的 Artifact（带 session_id）；代理下载 | ✅ |

会话与文件同时校验 `subject + purpose`，员工、不同管理员与不同用途之间均不可借用 ID。
迁移 `007_admin_debug_scope` 将历史 Session 与文件标为 `experience`，不迁移事件正文。
迁移 `015_template_debug_sessions` 为已有调试索引补齐 `source=project`；模版调试使用
独立 template 来源和运行时挂载摘要，project_name/agent_key 为空。所选远端文件经服务端
元数据复核后使用，不记录为当前管理员上传，下载权限仍由既有上传或会话产物归属决定。
迁移 `024_template_default_environment` 允许模版调试省略环境覆盖，完整保留既有会话索引、
运行时配置及用途/来源/归属约束；不改动旧会话的显式环境引用。
`auditor` 只能读取其权限范围内数据，所有写方法仍由统一中间件拒绝。消息、流、审批沿用
协议版本校验；管理端请求通过 apiBaseUrl 和目标服务独立的管理令牌发送。

模版新建与编辑经「选择配置 → 预览调试」后保存；下一步先完成本批资源的 Build/Plan/显式发布及绑定解析，再自动调用 `debug.sessions.createTemplate`。返回配置且运行时不变时保留会话；运行时变更、保存成功或离开向导时清理自建根 Session。
既有调试 API 的主体、用途隔离及资源复核合同保留，不新增后端操作，不修改或应用模版历史配置。
模版详情的「调试」Tab 复用同一调试 API，输入取详情当前版本快照，管理员进入 Tab 后自动创建；切换信息 Tab、
版本或离开详情时沿用本页面所拥有根 Session 的删除 plan 与确认清理；失败保留跨页面重试入口。

### 已保存模版

模版与历史版本接口仍仅返回本地快照。详情信息页按创建页字段顺序展示，并通过既有 Agent 版本、环境、记忆库配置和密钥库详情接口补齐资源信息。
Agent 显式版本按版本读取，旧记录版本仅作只读展示，不能改变运行绑定；环境、记忆条目和密钥元数据为引用对应的当前远端数据，并非模版保存时的正文快照。
这些读取不初始化或发布资源、不修改引用、不创建会话，不把记忆正文或凭据落库。

管理列表与创建预览共用基础配置字段投影；分页快照接口本身仍只读取本地目录。
前端通过既有 Agent 版本接口按当前页去重读取配置（优先运行绑定版本，其次保存时记录版本，无记录才读取当前版本），
通过记忆库、密钥库元数据列表补齐名称，不读取这两类资源的正文或密钥详情，不修改版本绑定。
资源名称展示当前元数据；加载失败可重试，搜索和切页取消旧读取，迟到结果不进入新页。

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `templates.list` | `GET /api/admin/templates` | `search/status/category/limit/page_token` 搜索、上架状态及分类筛选与游标分页；`status` 可选 `listed`/`unlisted`，`category` 可选广场分类，均省略为全部；返回 `TemplatesPage`，关联信息含可选 `listing.listed_at` 最近上架时间；名称或 Agent 名称/ID 匹配，按创建时间及 ID 倒序；仅读本地目录 | ✅ |
| `templates.create` | `POST /api/admin/templates` | `TemplateInput`：`name`、必填 `category`、远端 Agent ID、可选 `remote_environment_id` 与 `agent_version`、文件、记忆、密钥库引用和描述/开场白/示例问题；验证远端资源后写本地目录与第 1 版，返回 201 `TemplateView`；重名 409，auditor 禁写 | ✅ |
| `templates.get` | `GET /api/admin/templates/:templateId` | 返回最新完整 `TemplateView`（含当前关联的可选 `listing.listed_at`）；不存在 404，不依赖 Provider 在线 | ✅ |
| `templates.versions` | `GET /api/admin/templates/:templateId/versions` | `TemplateVersionsQuery`：`limit` 默认 20、最大 100，`page_token` 绑定模版与上一页末尾版本；返回 `TemplateVersionsPage`：`data:TemplateVersionSummary[]`、`current_version` 与可选 `next_page_token`，摘要含版本、名称、保存时间、智能体及运行时配置；版本降序且包含当前版本，只读本地历史，admin/auditor 可读 | ✅ |
| `templates.version` | `GET /api/admin/templates/:templateId/versions/:version` | 返回 `{data:TemplateVersionView}`；按模版 ID 与正整数版本读取不可变完整配置，`created_at` 为该版本保存时间，不包含当前 `listing/updated_at`；不存在 404，非法版本或跨模版游标 400，不查询 Provider | ✅ |
| `templates.update` | `PUT /api/admin/templates/:templateId` | `TemplateUpdateInput`：编辑或应用历史版本的完整配置（含必填 `category`）加当前 `base_version`；复核资源后原子追加版本并同步关联 Catalog，返回最新 `TemplateView`；版本或名称冲突 409、不存在 404，auditor 禁写 | ✅ |
| `templates.listing.plan` | `POST /api/admin/templates/:templateId/listing/plan` | `TemplateListingInput`：`{display_name}`，复核模版引用并返回 `PlanResponse`；不写入 Catalog，计划绑定主体、模版、展示名及目标条目状态 | ✅ |
| `templates.listing.confirm` | `POST /api/admin/templates/:templateId/listing` | `TemplateListingRequest`：展示名及 `plan_id/confirm_token`，显式确认后原子创建或重新上架关联条目，返回 `CatalogAgentView`；缺少或无效确认 428，冲突 409，auditor 禁写 | ✅ |
| `templates.delete.plan` | `POST /api/admin/templates/:templateId/delete/plan` | 无请求体，返回 `PlanResponse`；只读列出删除模版全部版本及关联 Catalog 的影响，绑定主体、目标、当前版本和关联条目快照；不访问 Provider | ✅ |
| `templates.delete` | `DELETE /api/admin/templates/:templateId` | `ApplyRequest` 确认令牌；原子删除模版、全部历史、关联关系及关联 Catalog，返回 `{data:{deleted:true}}`；缺少/无效令牌 428、快照漂移 409、不存在 404，auditor 禁写 | ✅ |

- 名称去首尾空白后 1–64 字符，在模版目录内精确比较唯一；不会覆盖同名记录。
- `category` 复用 `PlazaCategorySchema`，允许 `general/writing/coding/data/other`；新建与更新
  必须显式提交，缺失、空值或非法值返回 400。UI 默认通用；旧记录及历史缺失该字段时仅在
  读取中回退 `general`，不改写历史。分类独立于 Provider 运行时，不传调试会话接口。
- 列表先按搜索、模版分类和当前关联 Catalog 状态组合筛选，再分页；未关联或关联条目已删除
  均归入 `unlisted`。分类读取模版 `config_json.category`，旧缺失时视为 `general`，不使用
  Catalog 分类；非法分类返回 400，省略代表全部。游标绑定搜索、状态与分类，跨条件复用返回
  400；旧游标缺少分类时仅兼容未设置分类筛选的请求。筛选不改配置或状态，也不查询 Provider。
- `listing.listed_at?: string` 是关联 Catalog 最近一次转为已上架的 ISO 时间。迁移
  `023_catalog_listed_at` 添加可空列，旧记录不从创建或更新时间补齐；缺失时响应省略字段。
  下架、编辑及重复设置已上架均保留，重新上架更新；不属于模版不可变历史配置。
- `agent_version?: number` 为正整数，显式绑定远端 Agent 的运行版本；省略表示创建 Session
  时使用最新版本。保存、调试与上架校验所选版本确实属于该 Agent 且可用，失败不回退最新版本。
  新建模版向导仅提供具体版本，默认取 Agent 列表的合法 `version`，缺失时查询版本列表取
  最大正整数；预览和保存均提交该具体 `agent_version`。后端可选字段及旧数据语义保持兼容。
- 环境可选；`remote_environment_id` 省略表示使用所选智能体的默认环境，拒绝空串或 null。
  不解析或保存默认环境实际 ID，默认环境的可用性由 Provider 建会话时判断；显式覆盖仍复核资源存在性。
  完整更新省略即清除覆盖，同步已关联 Catalog 时转为 null，员工后续会话继续使用默认环境。
  历史版本保留各版是否覆盖的语义，无覆盖时环境 ID 与名称均省略。
  文件最多 10、记忆库最多 8、密钥库最多 10。文件校准名称、大小与挂载路径；
  记忆保存 ID、权限和说明；密钥库仅保存 ID，资源校验不读取凭据或资源正文。
- 展示字段沿用 Catalog 的限制：描述 400、开场白 2000 字，示例问题最多 8 条且每条 200 字。
  这些文案独立于 Provider 配置。输入不接受会话 ID、事件或任意 Provider 属性。
- `TemplateView` 追加 `template_id/created_at/updated_at/version/remote_agent_name/remote_agent_version?/remote_environment_name?`。
  `version` 是本地模版配置版本，始于 1，每次成功编辑递增；`created_at` 保持不变，`updated_at`
  记录本次保存时间，与 `agent_version` 独立。远端名称和 `remote_agent_version` 只是保存时
  元数据快照，不锁定远端状态，也不能作为显式绑定；
  文件、记忆、密钥库和示例问题省略时为空数组。
- 迁移 `016_saved_templates` 创建本地配置目录；模版保存接口本身不创建 Session、上架条目或
  Provider 资源。新建与编辑配置页不创建调试会话；本地资源由进入预览前的独立发布流程准备。
  所有管理身份可读，只有管理员可写，审计使用管理员指纹和模版 ID。
- 迁移 `018_template_versions` 为旧目录回填第 1 版与更新时间；`kit_template_versions` 以
  `(template_id, version)` 保存不可变完整配置快照。模版列表与普通详情只返回最新版，列表不显示版本号；
  独立版本列表和版本详情接口读取历史快照，名称、资源引用及展示配置均来自对应历史记录，
  不混入最新名称或关联状态，不提供覆写历史的接口。应用历史版本复用 `templates.update`，仅投影该版配置字段，
  以当前版本为 `base_version` 追加新版本；保留历史快照、Catalog 身份与上下架状态，不将历史版本号设为当前版本号。
  编辑或应用必须携带读取时的 `base_version`，冲突保留客户端草稿，
  不自动覆盖；资源失效、重名或版本冲突不新增版本。
- `TemplateVersionSummary` 在 `version/name/created_at` 外返回历史快照中的
  `remote_agent_id/remote_agent_name/agent_version?/remote_agent_version?`、
  `remote_environment_id?/remote_environment_name?`、`files/memory_stores/vault_ids` 和 `category`。
  版本时间线直接按点展示这些配置；每页一次读取历史 `config_json` 并按共享 schema 投影，
  不读取当前配置、不逐条请求版本详情或 Provider。展示文案等其余配置仍由版本详情接口提供。
- 迁移 `023_catalog_agent_version_binding` 只新增 Catalog 的 `agent_version` 列，不将历史
  `remote_agent_version` 快照转换为绑定。模版 `config_json` 自然兼容可选字段，旧模版未设置
  绑定时继续使用最新版本，不改动其本地配置版本与历史快照。
- 模版更新、历史追加及关联 Catalog 的运行时/分类/展示配置同步同事务提交；展示名同步模版名
  （截取 60 字），同步 `agent_version` 绑定（省略则恢复最新版本），保留条目 ID、slug、上下架状态及其他运营字段。
  Catalog 同步失败则全部回滚；无关联时不创建条目。员工目录读取同步后的配置，新会话采用
  最新运行时；既有 Session 不会中途替换 Agent、环境或挂载资源。
- `TemplateView.listing?` 为当前关联 Catalog 的 `{catalog_id,slug,display_name,status}`，
  由迁移 `017_template_listings` 的独立关联表维护；列表和详情实时读取本地关联，删除条目后
  不再返回旧关联。
- 上架展示名去首尾空白后 1–60 字符，沿用 Catalog 的名称唯一约束；slug 由服务端以模版 ID
  生成。计划和确认均复核 Agent、环境、文件、记忆库和密钥库元数据，不读取凭据。
  确认映射 `agent_version`、运行时引用、分类、描述、开场白和示例问题，不使用模版的版本展示快照锁定 Agent。
- 取消计划不创建草稿。一个模版最多关联一个现存 Catalog 条目，已上架返回 409；下架后
  重新上架复用原条目，恢复模版运行时、分类与展示配置并保留主题等其他运营配置，计划明确说明。
  token 绑定模版版本、目标配置与 Catalog 当前内容；编辑、改名、换模版、条目漂移或重放不能借旧计划执行。
  事务中同时写入 Catalog 与关联，冲突或资源失效不留下部分条目。
- 模版列表的下架操作使用当前 `listing.slug` 复用 `catalog.listing.plan` 与状态更新接口，
  先自动获取 `status=unlisted` 的计划，用户一次确认后提交；不新增模版下架协议或 Provider 写入。
  下架保留关联，列表状态来自 Catalog 的最新状态；尚未关联条目也展示「未上架」。
- 删除允许已上架与未上架模版；后台自动准备只读计划，弹窗正常正文固定为「是否删除该模版」，
  不显示模版名、`plan.diff` 或影响摘要，用户一次显式确认后执行。失败可在原弹窗展示错误与
  重试入口；重新准备计划成功后仍需显式确认，不自动执行删除。
  模版与其全部历史、关联关系及 Catalog 条目在同一事务删除；不删除 Session、远端 Agent、
  环境、文件、记忆或密钥库。既有会话仍由原归属与 Provider 合同控制，新会话入口不再可用。
  一次性令牌绑定管理员、模版及当前配置/关联 Catalog 快照，修改版本、上下架或目录变动后
  旧计划返回 409；跨主体/目标或重放拒绝执行。计划和删除不依赖 Provider 在线。

### 上架目录（Catalog）

管理端已移除独立上架目录页面；以下接口保留供模版上下架、既有客户端及体验目录使用。
页面移除不删除目录数据，不改变上架确认或新建体验会话合同。

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `catalog.list` | `GET /api/admin/agents` | 全部条目（含未上架） | ✅ |
| `catalog.create` | `POST /api/admin/agents` | 建条目（默认未上架）：body 为 protocol 的 `CatalogAgentInputSchema`（slug/展示名/远端 agent + 可选版本绑定 `agent_version` / 环境 `remote_environment_id` / 默认文件 `files` / 记忆挂载 `memory_stores` / 密钥库 `vault_ids` / 描述/图标/开场白/示例问题/能力/主题/可见性/排序）；`slug`（管理端显示为 ID）与展示名分别在目录内唯一，任一重复返回 `409 conflict`，不更新已有条目 | ✅ |
| `catalog.listing.plan` | `POST /api/admin/agents/:slug/plan` | `{action: "listing", status}` 或 `{action: "delete"}` → `{plan_id, confirm_token, diff, destructive, expires_at}` | ✅ |
| `catalog.setListing` | `PATCH /api/admin/agents/:slug` | `{status, plan_id, confirm_token}` 上/下架；缺令牌 `400`、伪造/重放 `428`（红线：上下架必须 plan → 确认） | ✅ |
| `catalog.update` | `PUT /api/admin/agents/:slug` | 改展示信息与体验页配置（展示名/描述/图标/开场白/示例问题/能力/主题/可见性/排序/版本绑定/环境/文件/记忆/密钥库）；`agent_version` 与 `remote_environment_id` 省略保留、`null` 清除对应覆盖；改名与其他条目重名返回 `409 conflict`，保留自身原名可保存；**status 不在此路径改**，body 里夹带也忽略 | ✅ |
| `catalog.delete` | `DELETE /api/admin/agents/:slug` | 删条目，需 `{plan_id, confirm_token}`（plan 的 `action:"delete"`）；缺令牌 `400`、伪造 `428`、条目不存在 `404`。只删 kit 目录，Provider 上的 Agent 与已有会话不受影响 | ✅ |
| `catalog.preview` | — | 体验页预览配置；当前用体验页 `?agent=<slug>` 深链代替 | 🚧 未实现 |
| `catalog.embed` | — | 生成嵌入代码片段（widget） | 📅 后续 |

目录 ID 对应 API 的 `slug` 字段，长度为 3–64 位；首尾必须为英文字母或数字，中间还允许
下划线与连字符。英文字母允许大小写，原样保存并区分大小写，支持直接使用 Provider 的
`agent_...` ID；已有小写连字符 ID 继续有效。创建后 ID 不可修改。

展示名按原字符串精确比较，范围包含已上架与未上架条目。历史同名数据不自动改名或删除，
仍可保留原名修改其他信息，但新建和改名不能产生新的重名条目。

`agent_version` 只接受正整数或 `null`：创建时省略或为 `null` 表示使用最新版本；更新省略
保留原绑定，`null` 清除绑定。新体验 Session 从服务端目录读取该配置，经既有 `POST /sessions`
窄入口将显式版本映射为 `agent: {id, version}`，未绑定时传 Agent ID 字符串。失效版本返回错误，
不得静默运行最新版本。`remote_agent_version` 保留兼容旧展示元数据，不参与运行绑定。

条目可指定 `remote_environment_id`，用于此后从体验页创建 Session 时传给 Provider 的
`environment_id`。创建时未选或更新为 `null` 使用 Agent 默认环境；更新省略该字段保留原值。
该字段只存远端环境 ID，不修改 Agent 配置或已有 Session。体验页请求不能自行覆盖环境，
服务端始终从已上架条目解析；远端环境失效时保留 Provider 拒绝，不静默切换环境。

目录 `files?: AttachmentRef[]` 最多 10 项，省略保留已有值，`[]` 清空。保存时逐项向 Provider
验证普通上传来源与 `available` 状态，文件名和大小采用服务端查询结果，拒绝伪造或失效文件。
未填路径时使用 `/mnt/session/uploads/<安全文件名>`；显式路径须为绝对文件路径，不含
`..` 或控制字符，重复文件与规范化后重复路径均返回 `400 invalid_request`。

新体验 Session 先校验成员提交附件的本人归属，再合并服务端目录文件，按 ID 去重，合计
最多 10 项；目录路径优先，成员同名附件自动添加后缀。目录配置不会把共享文件登记为成员
本人上传，不放开直接下载或任意 `file_id` 挂载。更新目录只影响后续新 Session。

目录 `memory_stores?: CatalogMemoryStore[]` 最多 8 项；每项为
`{memory_store_id, access: "read_only" | "read_write", instructions?}`。`access` 省略默认
`read_write`，说明最多 4090 字符（跟随参考表单，比 Provider 的 4096 字符上限更紧），
保存时去首尾空格、空说明省略。省略数组保留，`[]` 清空 Kit 配置；不宣称禁用 Agent 自身
默认资源。保存重新查询记忆库元数据，缺失或已归档返回 `400 invalid_request`，查询失败
返回脱敏 `502 provider_error` 并保留原值，重复 ID 与非法权限也拒绝。

体验端不能提交记忆挂载覆盖：新 Session 仅采用服务端已上架目录的库 ID、权限和说明，
与默认文件及成员本人附件共同组成 Provider `resources`；记忆权限不因成员请求而升级。
记忆库内容跨会话共享，读写挂载可修改原库。空配置不追加记忆资源，不修改已有会话；
`agents.list`、`agents.get`、`plaza.get` 仅输出公开协议字段，不暴露目录记忆配置及说明。
Kit 只读记忆库元数据，不提供记忆内容查询、编辑或创建接口，SQLite 不保存记忆内容。
Provider wire、权限和分页依据见 `docs/research/catalog-memory-stores.md`。

目录 `vault_ids?: string[]` 最多 10 项，仅选择当前工作空间已有且未归档的密钥库。省略
保留，`[]` 清空 Kit 配置；ID 去首尾空格，仅接受英文字母、数字、下划线与连字符，避免
SDK 的原样拼接路径被用来访问凭据子路由。重复、超限、失效或归档库返回 `400 invalid_request`，
上游元数据查询失败返回脱敏 `502 provider_error`，失败不覆盖原配置。

新体验 Session 只采用已上架目录的服务端密钥库绑定，向 Provider 发送顶层 `vault_ids`，
与 `environment_id` 及文件/记忆 `resources` 共存。成员请求不能覆盖绑定，公开目录及
广场不返回 `vault_ids`；空配置不追加密钥库，不宣称会清除 Agent 的其他默认配置。
Kit 不查询或复制库内 Credential，不提供创建库、生成密钥或补齐凭据操作。不同库的
凭据名称冲突等运行条件由 Provider 拒绝，不通过读取凭据内容来预判。只存库 ID 的迁移
为 `013_catalog_vaults`；wire 与元数据合同依据见 `docs/research/catalog-vaults.md`。

### 成员管理（本地账号）

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.members.list` | `GET /api/admin/members` | 本地成员公开资料、`groups` 摘要与 `usage_summary`；`?search=&limit=&page_token=` 搜索并以不透明游标分页；先返回缓存，按需后台刷新当前页成员的全部会话；不返回密码或派生值 | ✅ |
| `admin.members.get` | `GET /api/admin/members/:memberId` | 按稳定 ID 返回 `{data: MemberView}` 公开资料，供成员用量深链恢复；管理员与 auditor 可读，不存在返回 404，不返回密码或派生值 | ✅ |
| `admin.members.create` | `POST /api/admin/members` | 创建本地账号：`username`、`display_name`、可选 `email`、`auth_type: local`、`password_mode: auto\|custom`；custom 须带 `password`。返回 `{data:{member,initial_password?}}`，只有 auto 首次创建响应含初始密码；同名 `409 conflict`，审计不记密码 | ✅ |
| `admin.members.usage` | `GET /api/admin/members/:memberId/usage` | `{data: MemberUsageSummary}`；可选 `agent_slug` 筛选，`refresh=1` 强制调度后台刷新并立即返回当前缓存与进度；管理员与 auditor 可读 | ✅ |
| `admin.members.sessions` | `GET /api/admin/members/:memberId/sessions` | 成员会话累计用量明细，含已删除快照；`?agent_slug=&cursor=&limit=`，limit 默认 20、最多 100；返回 `{data,next_cursor?}`；汇总不受明细分页大小限制 | ✅ |
| `admin.usage.templates` | `GET /api/admin/usage/templates` | 以模版为主键聚合体验会话用量：只统计从该模版上架条目发起的会话（跨成员、含已删除）；模版全量返回，0 会话也出现，行含 `remote_agent_id`（模版绑定智能体，控制台用它按 agent_id 过滤模型/工具用量明细）；与成员用量的 `agent_slug` 明细同口径。读取即登记新会话并按成员后台补采，返回当前缓存；管理员与 auditor 可读 | ✅ |
| `admin.usage.templateSessions` | `GET /api/admin/usage/templates/:templateId/sessions` | 模版会话用量明细（跨成员、含已删除快照）；`?cursor=&limit=`，limit 默认 20、最多 100；行附带成员 `member_display_name`/`member_username`；返回 `{data,next_cursor?}`；模版不存在 404 | ✅ |
| `admin.usage.templateTrend` | `GET /api/admin/usage/templates/daily-trend` | 模版用量逐日趋势（管理端「使用趋势」柱状图）：来自限额账本条目逐日账 `kit_usage_limit_agent_days`，`tokens`=输入+输出 Token 增量、`active_seconds`=执行时长增量，按采集确认日（UTC 日键）归属，自模版限额账本启用起记录、不含更早历史；`?template_id=&days=`，`days` 仅支持 7/14/28（缺省 7），`template_id` 缺省为全部模版条目求和（非模版条目不计入；同一条目被多模版引用时随各模版重复计入，与「全部=各模版求和」一致）；区间零值补全到今天，返回 `{data:{days,from_day,to_day,since_day,data:[{day,tokens,active_seconds}]}}`（`since_day` 为逐日账最早记录日，无记录为 null）；模版不存在 404，管理员与 auditor 可读 | ✅ |
| `admin.usage.templateLimit.get` / `.put` / `.delete` | `GET` · `PUT` · `DELETE /api/admin/usage/templates/:templateId/usage-limit` | 模版限额（月度与日度，同成员限额口径，主体为该模版上架条目下全部成员合计）；PUT body 为 `UsageLimitConfig`（月度与日度两组字段，未设置覆盖时不限量）；超限发送返回 403 `quota_exceeded`；模版不存在 404，auditor 只读 | ✅ |
| `admin.usage.modelUsage` | `GET /api/admin/usage/model-usage` | Provider 侧（app-control usage.*）模型用量明细：`{items,total,total_call_count,page_no,page_size,data_updated_at}`，行含 `workspace_id/model_name/call_count/failed_count/tokens`；`?start_time=&end_time=`（毫秒，缺省最近 7 天）+ `agent_id/model_name/page_no/page_size/sort_by/sort_order`；workspace 由服务端凭据配置注入，前端不可传；传 `?session_id=` 时按会话口径（scope=session，忽略时间区间与 agent_id，按会话自身窗口统计）；sdk 网关调百炼、mock 返回演示数据；管理员与 auditor 可读 | ✅ |
| `admin.usage.toolUsage` | `GET /api/admin/usage/tool-usage` | Provider 侧工具调用明细：行含 `workspace_id/tool_name/source(builtin\|mcp\|custom)/call_count/failed_count`；筛选与分页同 modelUsage（`source/tool_name`、`sort_by` 限 call_count/failed_count）；管理员与 auditor 可读 | ✅ |

- `member` 包含 `member_id`、`username`、`display_name`、可选 `email`、`auth_type: local`、
  `status: active`、`created_at`、`updated_at`。时间均为 ISO-8601 UTC。
- 用户名去首尾空格并转小写，3–32 个字母、数字、点、下划线或连字符，首字符须为字母或
  数字；唯一约束在数据库执行。显示名称去首尾空格后非空且不超过 32 字符。
- 自定义密码为 8–32 个非空格 ASCII 字符，须同时含大写、小写、数字和特殊字符，且不能
  包含用户名（忽略大小写）。自动生成密码遵循相同规则；密码不 trim、不落明文、不进错误详情。
- 创建响应禁止缓存；自动密码仅显示在创建成功页，离开后不可重新查询，自定义密码不回传。
  创建后可使用账号登录体验页；暂不提供密码重置、删除、停用或 SSO 接口。
- GET / POST 均要求管理端身份，`auditor` 可以查询但不能创建。`member_id` 是 Kit 成员 ID，
  登录后作为 `subjectId`，不自动迁移既有匿名会话或 Credits。

#### 用户组管理

管理端已移除用户组界面；以下控制面 API、现有用户组和成员关系继续保留。

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.groups.list` | `GET /api/admin/groups` | 用户组列表；`search/limit/page_token` 搜索与游标分页 | ✅ |
| `admin.groups.create` | `POST /api/admin/groups` | `{name,description?}` 新建空组；同名 `409 conflict` | ✅ |
| `admin.groups.get` | `GET /api/admin/groups/:groupId` | 用户组详情、成员数量与 revision | ✅ |
| `admin.groups.update` | `PATCH /api/admin/groups/:groupId` | `{name,description?}` 编辑名称和描述；不改变 ID 或成员关系 | ✅ |
| `admin.groups.plan` | `POST /api/admin/groups/:groupId/plan` | `{action:delete}` → `PlanResponse`；展示组与成员关系删除影响 | ✅ |
| `admin.groups.delete` | `DELETE /api/admin/groups/:groupId` | `{plan_id,confirm_token}` 确认删除；仅删除组及关联，不删除账号 | ✅ |
| `admin.groups.members.list` | `GET /api/admin/groups/:groupId/members` | 搜索分页本地成员；支持 `membership`，行含 `is_member` | ✅ |
| `admin.groups.members.patch` | `PATCH /api/admin/groups/:groupId/members` | `{add_member_ids,remove_member_ids}` 原子更新成员关系，返回组详情 | ✅ |
| `admin.members.groups.list` | `GET /api/admin/members/:memberId/groups` | 搜索分页用户组；支持 `membership`，行含 `is_member` | ✅ |
| `admin.members.groups.patch` | `PATCH /api/admin/members/:memberId/groups` | `{add_group_ids,remove_group_ids}` 原子更新同一份成员关系，返回 `{data:{updated:true}}` | ✅ |

- 本期只维护本地分组，不限制 Agent 访问；admin 可写、auditor 只读。用户组没有嵌套、
  启停状态或管理员权限；匿名、外部 JWT 不作为可配置成员。
- 组详情包含 `group_id/name/description?/member_count/created_at/updated_at/revision`。
  `group_id` 自动生成且不复用；名称去首尾空格后 1–64 字符、精确比较唯一，描述最多 500
  字符，省略保留原值、空字符串清空。新建组没有成员，升级不自动分配已有用户。
- 分页默认 20 条、最多 100 条，返回 `{data,next_page_token?}`；成员关系查询的
  `membership=included|excluded|all` 默认 included，all 用于搜索多选候选及回显当前关系。
  游标绑定查询条件及目标，换搜索、过滤条件或目标时必须从首页开始。
- 两侧关系写入均为明确的增删集合，省略数组视为空；重复增删幂等，同一 ID 同时增删拒绝。
  每个数组最多 1000 项，全部 ID 存在性校验与关系变化在一个事务中完成，失败无部分写入。
  分页只影响展示，未展示的关系不会被完整替换。
- 删除计划绑定管理员、组及当前 revision；成员变化或组编辑后旧计划 `409 conflict`，
  必须重新审阅。缺少、伪造、过期或重放确认令牌为 `428 confirmation_required`。
  组删除保留用户、登录态、会话、用量和审计历史。
- 管理端成员列表 API 使用 `AdminMemberView`，额外包含 `groups: {group_id,name}[]`；当前界面不展示组摘要。
  创建用户与成员登录沿用 `MemberView`，不返回组信息。用户组写操作不写入智能体操作日志。

#### 成员累计用量合同

- 管理员端「用量」复用 `admin.members.list` 展示成员 Session 累计统计，支持成员搜索与
  游标分页；Session 数包含已删除且保留快照的会话。列表「刷新列表」重新读取当前页并
  遵守采集 TTL，不强制刷新所有成员，也不将当前页加总标成全局总计。进入成员详情后，
  复用 `admin.members.usage` / `.sessions`，提供 Agent 筛选、明细分页与「刷新用量」强制采集。
- `SessionUsage` 的可选字段为 `input_tokens`、`output_tokens`、`cache_read_input_tokens`、
  `cache_creation_input_tokens`；`SessionStats` 为 `active_seconds`、`duration_seconds`。
  指标均为 Provider 累计绝对值。SDK 公开 `getSession().attributes` 由 Gateway 白名单解析；
  缺失与错误均不能当成零，时长保持秒单位，不读取 SSE 正文推算 token。
- `MemberUsageSummary` 包含 `session_count`、`deleted_session_count`、各指标
  `metrics.{name}.{value,covered_sessions}`、`refreshed_at?`、`refresh_status` 和
  `completed_sessions`；`agents` 始终是该成员全部 Agent slug，用于筛选器。
  `refresh_status` 为 `idle | refreshing | partial | failed`。无会话返回 0；存在会话但
  某指标全部未知时 `value=null`，部分已知时只汇总已知值并附覆盖数。上次采集成功但本次失败
  可以保留旧数值，成员列表与详情均须同时显示状态和采集时间；即使 coverage 完整，也
  不能将 `partial` / `failed` 的旧值显示成已全部更新。
- 明细包含 `session_id`、`member_id`、`agent_slug`、标题、状态、创建时间、可选 `usage/stats`、
  `captured_at`、`deleted_at`，以及 `pending | complete | partial | failed | not_found`
  采集状态。游标绑定成员与 Agent 筛选，切换筛选须从第一页开始；汇总与明细使用相同筛选。
  翻页失败时保留本次目标页码与错误，禁用使用旧游标的继续前翻；重试读取同一目标页。
  重试与前后翻页必须保持页码、游标与会话明细对应。
- 统计只关联本地目录中真实存在的成员与 experience 会话，不包含匿名、外部 JWT、管理员
  调试会话。刷新默认 60 秒 TTL，新建的待采集会话可提前触发刷新；同一成员合并任务，最多
  4 个有效采集任务。单个详情等待 15 秒后标记失败并忽略迟到结果；SDK 未提供详情取消信号，
  不保证超时底层 HTTP 已终止。历史记录分批遍历全部会话。此累计统计与月度限额的独立
  基线和增量账本不可混用。
- 成员删除路径的失败返回 `409 conflict`，`retryable=true`，错误详情含
  `stage: stop | capture | delete | finalize`、`execution_stopped`、`deletion_uncertain`。
  停止或保存失败不发送 DELETE；远端删除结果不明时保留快照与写入保护，用户重新生成计划并
  显式确认重试后核实。网络错误后 GET 仍存在不代表 DELETE 被拒；重试采集和重启不能
  丢失此前的删除阶段。发出中断后的保护也不能因 idle 加后续采集失败而解除。
  输入和输出 token 必须有效并成功落库；上游未提供缓存或时长指标时
  可保存部分快照并明确标记，不能伪造为零。完整时序见 `docs/protocol.md`。

### Session 限额（月度与日度）

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.usageLimits.policy.get` / `.put` | `GET /api/admin/usage-limits/policy` · `PUT /api/admin/usage-limits/policy` | 默认配置；PUT `{monthly_tokens,monthly_active_seconds,daily_tokens?,daily_active_seconds?}`（日度缺省不限量，未设置时跟随月度上限约束与展示），返回 `{data:{limits,updated_at?,updated_by?}}`；日度上限不得高于月度上限（Token 与执行时长分别校验，违反 400） | ✅ |
| `admin.members.usageLimit.get` / `.put` / `.delete` | `GET /api/admin/members/:memberId/usage-limit` · `PUT /api/admin/members/:memberId/usage-limit` · `DELETE /api/admin/members/:memberId/usage-limit` | 获取、完整覆盖个人配置（月度与日度整体提交）、恢复默认；PUT 同默认配置 body（含日度跟随月度与「日 ≤ 月」校验，模版限额同规则）；均返回 `{data: MemberUsageLimitView}`，不存在成员 404 | ✅ |

- Token 上限为非负安全整数，时长为非负有限秒数；月度字段均必传，日度字段缺省 `null`（跟随月度上限约束与展示，不做日度拦截），`0` 禁止新增消耗，日度不得高于月度（校验拒绝）。日度按 UTC 日键记账（增量归采集确认日），条目日账与成员逐日账同事务双写；任一启用周期、任一指标达限即拦截后续发送。
  默认均不限量；覆盖配置整体替换默认，恢复默认后重新继承。写入仅 admin，可读含 auditor，
  限额写入不记操作日志，所有响应禁止缓存。页面设置和恢复默认均展示差异后由用户确认。
- `MemberUsageLimitView` 含 `member_id/month/reset_at/limits/override`、`tokens/active_seconds`、
  `day_state`（今日限额状态 `{day,reset_at,tokens,active_seconds}`）、`accounting_started_at/refreshed_at?` 与 `daily`。
  指标为 `{limit,used,remaining,status}`，状态是
  `ok | exceeded | unavailable`；未知用量及剩余为 null，不能补零或用旧值继续放行。
  `daily` 为近 30 天（含今天，UTC 日键升序、零值补全）逐日 `{day,tokens,active_seconds}` 增量，
  与月账同事务双写、归因到采集确认日，跨天会话有滞后，仅供展示不参与限额判定。
  启用逐日账前的历史增量由一次性迁移按当月每日调用次数占比分摊（当日真实 Token 无法还原，
  属估算），每日总和与当月月账一致；无调用记录的月份保持空缺，之后新增量实时逐日记。
- 范围是本地成员所有 experience 会话，不受 Agent 筛选或页面分页影响。Token 是输入加输出，
  时长为 `active_seconds`；缓存与 `duration_seconds` 不参与限额。任一启用指标 `used >= limit`
  时拒绝后续发送和允许工具执行；拒绝审批、中断与确认删除仍可执行。
- 首次成功采集建基线，不回填启用前历史；UTC 月增量按 Kit 受理轮次的开始月归属，月初重置。
  跨月一轮归开始月。Provider 延迟上报可能归到下一次受理月，不保证按实际发生时间精确切月。
  已运行一轮可超过上限，系统不会自动中断；协议中的不确定发送保护与未知指标规则仍适用。

### 评测浏览（只读）

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.eval.workspaces` | `GET /api/admin/eval/workspaces` | `KIT_EVAL_WORKSPACES` 配置的 workspace 列表（name/skill/runs 数）；auditor 可读 | ✅ |
| `admin.eval.runs` | `GET /api/admin/eval/runs` | `?workspace=` 下 complete 的 run 摘要（pass_rate/baseline Δ/infra 排除），新→旧；残 run 跳过 | ✅ |
| `admin.eval.runs.get` | `GET /api/admin/eval/runs/:runId` | `?workspace=`；逐 case 断言 + 基线 + `report_html` 原文（console 用 srcdoc 渲染，令牌不进 URL） | ✅ |

### Credits 配额与提额审批（兼容 API）

以下服务端接口保留兼容；管理员端「用量」展示 Session 用量及 Token/执行时长限额，不提供
Credits 政策、审批、override 或加油包操作。本地成员使用新月度限额，不受这些 Credits 配置
控制；匿名/JWT 的 Credits 展示、申请和限制保留原合同。

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `admin.quota.policy.get` / `.put` | `GET /api/admin/quota/policy` · `PUT /api/admin/quota/policy` | 默认月度政策（`-1`=不限量）；PUT 仅 admin，不写入操作日志 | ✅ |
| `admin.quota.overrides.list` | `GET /api/admin/quota/overrides` | 每员工长期上限（含当月 used/packs/remaining） | ✅ |
| `admin.quota.overrides.put` / `.delete` | `PUT /api/admin/quota/overrides/:subjectId` · `DELETE /api/admin/quota/overrides/:subjectId` | 设置/删除 override（删除后回落默认政策） | ✅ |
| `admin.quota.packs.create` / `.delete` | `POST /api/admin/quota/packs` · `DELETE /api/admin/quota/packs/:packId` | 发放/删除当月加油包（仅其 month 内有效） | ✅ |
| `admin.quota.requests.list` | `GET /api/admin/quota/requests` | 审批队列，`?status=pending\|approved\|rejected` 过滤（省略=全部） | ✅ |
| `admin.quota.requests.review` | `POST /api/admin/quota/requests/:id/review` | `{action: approve\|reject, mode?, granted_credits?, note?}`；approve 必须二选一 `mode`（override=改长期上限 / pack=当月加油包），reject 必须带 note；**不走 plan→confirm 闸门**（非 IaC 破坏性动作），不写入操作日志 | ✅ |
| `admin.quota.usage` | `GET /api/admin/quota/usage` | 当月每 subject 用量；`?month=YYYY-MM` 可查历史月 | ✅ |

### 运营与透传

| op | 方法与路径 | 说明 | 状态 |
| --- | --- | --- | --- |
| `operations.list` | `GET /api/admin/operations` | 长任务 Operation 列表；管理端日志页使用 `admin.audit.list` | ✅ |
| `presetPacks.preview` | `POST /api/admin/preset-packs/preview` | 创建页导入抽屉使用的只读配置准备。请求复用 `{remote_agent_id,agent_version?,resources:[{type,resource_id}]}`；重新发现并核验归属、固定版本、元数据和创建页可表示范围，返回 `{data:PresetPackPreview}`，仅含配置引用及安全名称，不含保存 ID/时间。响应 no-store，不写预设包/模版/会话索引，不调用 Provider 写操作。admin 可调用，auditor 沿现有 POST 权限拒绝；400 为无效选择，409 为资源已变化或不可用，502 为 Provider 失败。浏览器只在内存中回填配置，无需预先保存；旧 create/list/get 仅兼容历史保存流程 | ✅ |
| `presetPacks.list` | `GET /api/admin/preset-packs` | 兼容历史保存流程：admin/auditor 读取本地已保存预设包摘要，响应 no-store，不查询 Provider。`search` 最多 200 字，按智能体名称、Agent ID 或预设包 ID 做字面包含匹配；`limit` 默认 10、范围 1–100，`offset` 默认 0、非负整数。按保存时间及 ID 倒序，分页与 total 使用同一过滤条件；返回 `{data:PresetPackSummary[],total}`，摘要只有 `preset_pack_id/remote_agent_id/remote_agent_name/agent_version/created_at/resource_count`，不返回资源明细。当前创建页导入抽屉展示远端智能体列表，不使用此目录；400 表示查询无效，401 表示未认证 | ✅ |
| `presetPacks.create` | `POST /api/admin/preset-packs` | 兼容历史显式保存流程，当前 UI 不调用：admin 保存预设包，auditor 禁止写入；请求为 `{remote_agent_id,agent_version?,resources:[{type,resource_id}]}`，允许空资源列表。重新发现所选 Agent 的资源并核验每个身份，固定提交版本或当前版本，复用目录资源校验核实可用状态与安全元数据；返回 `201 {data:PresetPackView}`。配置仅含 Agent ID/版本、可选环境 ID、文件引用及路径、记忆库 ID/权限、密钥库 ID、安全名称与保存时间，写入 `kit_preset_packs`，响应 no-store。最多一个环境、10 个文件、8 个记忆库、10 个密钥库；无 ID、不支持的类型/文件权限、多文件路径或记忆权限冲突明确拒绝，记忆权限缺省只读。400 表示无效配置，409 表示资源已变化/越出所选 Agent 范围或文件尚不可用。失败不落库，不读取事件/正文/Credential，不创建会话、模版、发布或上架 | ✅ |
| `presetPacks.get` | `GET /api/admin/preset-packs/:presetId` | admin/auditor 按 ID 读取历史保存的配置引用，返回 `{data:PresetPackView}`，响应 no-store；不重新查询 Provider 或恢复会话，缺失返回 404。兼容旧链接 `/templates/new?preset=<id>`：读取并初始化草稿，展示名称及文案留空，刷新重新读取历史记录。当前 UI 导入使用 `presetPacks.preview` 并只在内存中传递配置，不生成此链接、不写保存记录 | ✅ |
| `operations.get` | `GET /api/admin/operations/:operationId` | Operation 状态、阶段、日志、结果；资源发布可选 publication 逐资源终态与安全 error_details，旧记录缺省兼容；报告不代替成功证明，retryable 不表示可重发 | ✅ |
| `operations.events` | `GET /api/admin/operations/:operationId/events` | Operation 完整状态快照 SSE；连接即发送当前状态，终态发送 done；刷新可按 ID 恢复，不重发执行请求 | ✅ |
| `admin.audit.list` | `GET /api/admin/audit` | 当前管理身份的操作审计日志，管理端「日志」页使用。`limit` 默认 100、范围 1–200，`offset` 默认 0、非负整数；服务端按已认证的管理员主体过滤后再分页及统计 total，不允许客户端指定其他主体，写入与查询共用智能体五类操作白名单：`templates.create/update/delete/listing` 与 `catalog.create/update/delete/list/unlist`（旧目录兼容入口）。其他动作不写入；排除其他管理员、成员、无主体及历史非白名单记录。按 ID 倒序返回 `{data:AuditLogView[],total}`，单条含 `id/at/subject/action/target/detail`（detail 保留可空 JSON 字符串，兼容历史记录）。admin/auditor 均只可读本人记录，响应 no-store；管理员主体为令牌指纹 `admin:<role>:<8hex>`，不含令牌原文，页面不展示操作人。智能体新建/编辑/删除及上下架成功后记录动作、目标与脱敏名称快照，编辑附配置版本，删除后日志保留；不记录配置正文或凭据 | ✅ |
| `admin.metrics` | `GET /api/admin/metrics` | Prometheus 文本指标；label 只有路由模板/方法/状态码，绝不含令牌、事件正文与用户输入 | ✅ |
| `remote.agents.list` | `GET /api/admin/remote/agents` | Provider 侧完整 Agent 列表；服务端通过 SDK 的百炼 MA Agent List 沿 Provider 游标读取全部页并按 ID 去重，返回 `{data: [{agent_id,name,version?,is_coordinator?}]}`，其中 `version` 是当前元数据而非运行绑定，`is_coordinator=true` 标记非空协调名册，供基础配置排除嵌套协调 Agent，不返回完整名册；导入预设包的首个智能体模块按完整结果在浏览器内每页展示 10 条名称、ID、版本，不按 Kit 模版或上架状态过滤；新建模版第一步按名称/ID 搜索并在浏览器内每页展示 10 条；不改变 Provider 资源 | ✅ |
| `presetPacks.agentResources` | `GET /api/admin/preset-packs/agents/:agentId/resources` | 预设包只读发现，admin/auditor 可读，响应 no-store。SDK 按 `agent_id` 遍历全部可见会话并按 ID 去重，最多并发 4 个会话读取详情与全部运行时挂载页；核验列表/详情归属，合并环境、密钥库、创建资源与当前挂载引用。返回 `{data:PresetPackAgentResources}`，含 `agent_id/complete/sessions`；各会话仅有 ID、状态、可选时间、资源数组及可选安全错误摘要。资源只含类型、资源/文件/记忆/环境/密钥库引用、脱敏仓库 URL、挂载路径、权限和 session/runtime 来源，按同会话引用、路径及权限去重，保留不同权限供导入冲突校验。会话列表失败返回 502；个别资源分页失败保留已读各页及会话配置并标记 complete=false，不伪装完整。404 表示 Agent 不可访问；不查询事件、资源正文或凭据，不返回标题、变量或原始属性，不补写本地索引，不恢复删除或卸载历史 | ✅ |
| `remote.agents.versions` | `GET /api/admin/remote/agents/:agentId/versions` | 指定 Agent 的全部实际版本，返回 `{data:[{version:number}]}`；经 SDK 公开接口读取全部页，正整数版本去重后降序，异常或循环分页报错；只投影版本号，不下发 Provider 原始配置；模版第一步打开版本选择时按需查询，Agent 列表缺失合法版本号时自动查询以取得具体默认版本 | ✅ |
| `remote.agents.version` | `GET /api/admin/remote/agents/:agentId/versions/:version` | `RemoteAgentVersionDetail`：精确历史版本的 `agent_id/name/version/created_at?/description?` 与 `configuration`（模型、指令、工具、Skill、MCP、multiagent）；SDK 公开接口按指定版本读取并校验 ID/版本一致，缺失或归档 404，不回退最新版；Skill 缺名引用按其版本补充名称，无版本时读当前元数据，补名失败保留引用，不改变绑定；只投影允许字段；description 与 instructions 按原文返回、展示和复制，不参与通用脱敏或 URL 裁剪/规范化，其原有占位符不表示受损。其他字段在服务端脱敏凭据、请求头、环境变量、命令参数与 URL 认证/查询信息，不下发原始 attributes/metadata。其他字段发生转换时附 `redacted_fields`，仅含受控配置区名 `name/description/model/instructions/tools/skills/mcp_servers/multiagent`；名册的 Provider 字符串 ID 或 `{type:agent,id}` 无损转为 `{agent_id}`，Self 的 id:null/version:null 按未设置省略，支持导入/另存；非空成员身份/版本及未知扩展保留以便明确拒绝有损复制；有损展示值即使无占位符也禁止另存，原版本仍可使用；admin/auditor 可读，抽屉展开单版时按需查询 | ✅ |
| `remote.environments.list` | `GET /api/admin/remote/environments` | Provider 侧完整环境列表 `{data:[{environment_id,name}]}`，供上架表单与新建模版环境导入抽屉按名称/ID 搜索选择；SDK 按游标读取全部页并按 ID 去重，无名称时回退 ID；缺失或重复游标报错，不返回截断列表；新建模版选择仅保留在页面草稿中 | ✅ |
| `remote.environments.get` | `GET /api/admin/remote/environments/:environmentId` | `RemoteEnvironmentDetail`：环境 ID/名称、可选描述/作用域/版本/类型/时间、`package_status`（仅 `building` / `ready`）、逐项脱敏的字符串 `metadata`，以及 `configuration` 内的类型、网络策略、apt/pip/npm/go/cargo/gem 软件包、脱敏变量与脚本标记；`copy_restricted_fields` 以受控字段路径标记有损投影或表单无法复制的配置，原环境仍可直接使用；描述 null 不算投影损失，作用域不作为复制限制，SDK 支持且未脱敏的网络策略允许复制，可选 null 字段规范化为省略；UI 展示概览、网络策略、预装包和元数据。经 SDK 公开详情接口读取并验证 ID，缺失或归档 404；只从 attributes 补充已知包状态，未知不填；每层按白名单投影，敏感元数据值、变量值和脚本统一为 `[redacted]`，其余文本与 URL 脱敏，不返回原始 config/attributes/metadata；admin/auditor 可读，不创建会话、不改变环境选择 | ✅ |
| `remote.files.list` | `GET /api/admin/remote/files` | 已上传文件完整列表 `{data:[{file_id,filename,size?,status?,available}]}`，供上架表单与新建模版运行时步骤选择；SDK 遍历所有页并过滤普通上传来源，保留不可用状态供禁用；排除输出和 Session 内部副本，不返回下载 URL 或原始属性；模版文件选择仅保留页面引用 | ✅ |
| `remote.memoryStores.get` | `GET /api/admin/remote/memory-stores/:storeId` | 返回 `MemoryStoreConfiguration`：`{memory_store_id,name,description,entries:[{key,content}],copy_restricted_fields?}`。仅管理身份显式导入后调用，先核验未归档库及 ID，SDK 公开接口以 20 条分页并遍历子目录、按 ID 去重，缺少正文时补读并核验路径/归属/SHA；缺失或循环游标、缺正文、重复路径、读期间变化、超出 1000 项/单项 100 KiB/总计 512 KiB 时拒绝不完整复制。只投影名称、描述和条目路径/正文，凭据式文本脱敏并标记不可复制，读写共用规则覆盖 JSON/YAML 引号及转义值，不返回 metadata/actor/原始错误。no-store，不落库、审计或日志，不修改原库，选择列表与会话挂载不调用。无效 ID 400、缺失/归档 404、读取不完整 502 | ✅ |
| `remote.memoryStores.list` | `GET /api/admin/remote/memory-stores` | 未归档记忆库完整列表 `{data:[{memory_store_id,name}]}`，供上架表单与记忆库配置导入抽屉搜索选择，以及运行时资源详情在条目快照不可读时重新核验原库是否仍可引用；SDK 公开元数据接口遍历全部页，按 ID 去重，无名称回退 ID，缺失或循环游标报错；仅管理端可读，不读取记忆内容；模版配置仅保留页面草稿 | ✅ |
| `remote.vaults.list` | `GET /api/admin/remote/vaults` | 未归档密钥库完整列表 `{data:[{vault_id,name}]}`，供上架表单与模版密钥库配置导入抽屉选择；SDK 公开接口完整分页并按 ID 去重，`display_name` 缺失回退 ID，异常分页报错；只返回库 ID 与名称，不读取凭据列表或内容；模版选择仅保留页面草稿 | ✅ |
| `remote.vaults.get` | `GET /api/admin/remote/vaults/:vaultId` | `RemoteVaultDetail`：`{vault_id,name,credentials:[{credential_id,name,secret_name,allowed_hosts}]}`。仅 admin/auditor 显式查看或在模版表单展示已导入库时调用；校验安全 ID、SDK 返回 ID 一致、库未归档，再经 SDK 公开 runtime provider 的 `listCredentials` 查询所有页并按密钥 ID 去重。只投影展示字段并脱敏文本，不返回密钥值、auth、metadata、注入配置或原始错误，不缓存/落库/写资源。缺失或归档 404，无效 ID 400，Provider 故障 502；选择列表、绑定校验和会话创建不调用此接口 | ✅ |
| `remote.skills.list` | `GET /api/admin/remote/skills` | 管理端 Skill 候选只读列表，查询参数 `source=official/custom`（默认 `custom`），`{data:RemoteSkill[]}` 含 `skill_id/name/description?/source/status/latest_version?/available`。SDK 公开列表按来源读取全部游标页并去重，缺失/循环游标拒绝返回截断结果；前端按名称/ID 搜索。名称和描述脱敏，不下发 attributes、正文或下载链接；仅 `active` 且存在明确版本时可选择。新建 Agent 保存 `{type,skill_id,version}` 固定版本引用，经 SDK 公开详情与精确版本元数据复核 ID、来源、版本和生效状态，缺失/失效拒绝且不回退最新。admin/auditor 可读，查询和保存校验均不创建资源、不下载 Skill、不 Build 或发布 | ✅ |
| `deployments.list` / `.run` / `.pause` / `.unpause` / `.runs` | `GET|POST /api/admin/deployments…` | 透传；run/pause/unpause 需确认令牌 | 📅 后续 |

## 跨层接口

| 接口 | 定义位置 | 消费方 |
| --- | --- | --- |
| `ProviderGateway` | `apps/server/src/gateway/types.ts` | `SdkGateway` / `MockGateway` / services |
| `CredentialResolver` | `apps/server/src/identity/credentials.ts` | gateway 构造 |
| `IdentityProvider` | `apps/server/src/identity/types.ts` | server 身份中间件；仅 server 使用 |
| `CatalogStore` / `OperationStore` | `apps/server/src/store/types.ts` | `node:sqlite` 实现；预留 Postgres |
| `EventBuffer` | `apps/server/src/services/event-buffer.ts` | 内存实现；预留 Redis adapter |
| `KitClient` | `packages/sdk/src/providers/kit/client.ts` | SDK 各功能 `/hooks` hooks、仓库脚本、测试 |
| `ClientOperations` | `packages/sdk/src/providers/kit/client.ts` | 显式 Client 的可选请求映射；复用 Request/BackendOperation 与现有 DTO，缺失能力不回退固定路由 |
| 组件调用流程 | `packages/sdk/src/sessions/`、`files/`、`chat/composer.ts`、`usage/` | Web、各功能 React hooks 与外部前端；目录、附件、首次发送、详情、产物和额度恢复，不新增 server op |
| `ArtifactHost` | `packages/sdk/src/files/artifacts.ts` | 宿主注入预览与保存回调；SDK 不访问浏览器交互 API，不携带身份配置 |
| `ChatProvider` | `packages/sdk/src/providers/contract.ts` | Controller；五项必需操作、可选线程列表/事件查询与消息转换策略 |
| `MessageTransformer` / `ChatMessage` | `packages/sdk/src/messages/` | Provider 定义转换，Chat 调用并持有结果，UI 消费消息 |
| `HostCapabilities` | `apps/web/src/lib/host.ts`、`templates/web-experience/src/lib/host.ts` | 壳注入 `window.__OPENAGENTPACK_KIT_BRIDGE__`，浏览器 fallback；不进入 SDK |
