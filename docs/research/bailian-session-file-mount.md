# 研究：bailian 建会话时挂载文件的真实 wire 形状（2026-10-14 live 实测；2026-11-02 追测运行时挂载；2026-11-03 判定沙箱物化）

结论直接约束 `apps/server/src/gateway/{sdk,bailian-rest}.ts`。探针脚本是一次性的，放在被
gitignore 的 `apps/server/.scratch/`（`probe-file-mount.ts` / `probe-file-mount2.ts` /
`probe-file-mount3.ts` / `probe-create-paths.ts` / `probe-mount-sandbox-visibility.mts`）；
可复跑部分是 `tests/live/smoke.ts` 的 `verifySessionLifecycle`。

## 一句话结论

**沙箱里能真正读到文件的唯一路径是运行时挂载**（`POST /sessions/:id/resources`，
type `file`，2026-11-03 实测 agent bash 可读）；
`POST /sessions` 的 `resources: [{ type: "file_resource", file_id, mount_path }]` 返回 200 且
详情回显绑定，**但 sandbox 不物化**（agent `ls /mnt/session/uploads/` 报 No such file or
directory）；SDK 0.8 发的 `type: "file"` 会被拒（400），顶层 `files: [...]` 会**假成功**
（200 但不挂载）。

## 探针矩阵

前置：`POST /files`（multipart）上传 52 字节 txt → `file_…`，`available=false`、
`status=checking`，约 14~18s 后 `status=available` / `available=true`。**必须等 available 再绑定**。

| # | 请求形状（`POST /sessions`） | 结果 | `GET /sessions/:id` 回显 |
| --- | --- | --- | --- |
| V1 | SDK `createSessionForAgent({ files: [{ fileId, mountPath: "/mnt/kit-probe.txt" }] })` | **400** `invalid_parameter: "Invalid resource"`（request_id `46813990-3a32-9fea-b036-aca5fbb08e2f`） | — |
| V2 | `resources: [{ type: "file", file_id }]` | **400** 同上（`e695d44f-864f-47f1-9b37-a47f-2c19757caf33`） | — |
| V3 | `resources: [{ type: "file", file_id, mount_path }]` | **400** 同上（`60db56a8-bb06-9cb4-b225-b5a5479ab68b`） | — |
| V4 | `resources: [{ type: "file", file: { id }, mount_path }]` | **400** 同上（`4e2f9519-8d02-96b5-a708-927d395e2ea5`） | — |
| V5 | 顶层 `files: [{ file_id, mount_path }]` | 200 | `resources: []`（**未挂载，静默忽略**） |
| V6 | `resources: [{ type: "file_resource", file_id }]` | 200 | `resources: [{ id: "sesrsc_…", type: "file_resource", file_id, mount_path: null }]` |
| R1 | `resources: [{ type: "file_resource", file_id, mount_path: "/mnt/kit-probe3.txt" }]` | 200 | 同上，`mount_path` 原样回显 |
| R3 | 同时给 `files` 与 `resources` | 200 | 只回显 `resources` 里的那条（`files` 仍被忽略） |
| P1 | `resources`/`files` 场景下**省略** `environment_id` | 200 | 用 agent 默认环境 |
| P2 | `mount_path: "/mnt/session/uploads/<name>"` | 200 | 原样回显（该目录可用，无保留限制） |

补充事实：

- `GET /sessions/:id` 的字段是 `id/type/status/agent/environment_id/environment_variables/title/
  metadata/stop_reason/resources/vault_ids/stats/usage/archived_at/created_at/updated_at/
  mcp_configs/request_id`；**没有** `files` 字段，挂载关系统一在 `resources`。
- SDK 的 `ProviderSessionInfo.attributes` 就是这份原始载荷，所以 gateway 能从
  `attributes.resources` 读回挂载（`filesFromResources`）。
- `DELETE /sessions/:id` 生效；删除后 `getSession` 抛错 → gateway 映射为 `null`。
- `POST /sessions/:id/archive` 生效（`archiveRemoteSession`），归档后仍可 `DELETE`。

## 另一条独立限制：`createSessionForAgent` 只认 config 声明键

`createSessionForAgent(ctx, { agent: "agent_example" })`（空 `agents` config）→
`UserError: Agent 'agent_example' not found in config. Available agents: (none)`。

kit 的 catalog 存的是**远端 agent id**，因此数据面建会话不能用这个入口。

## 对 kit 的影响（2026-10-14 当时的落地；已被 2026-11-02/11-03 两节修订）

1. `SdkGateway.createSession` **统一走 REST** `POST /sessions`（`gateway/bailian-rest.ts`），
   入参 `{ agent: <远端 id>, title?, resources?: [{ type: "file_resource", … }] }`，
   同时解决上面两条限制；空 `resources` 省略不发。
2. 附件只在**建会话**时挂载；`POST /api/kit/sessions/:id/messages` 带 `attachments` 一律 400
   （见 `docs/protocol.md`「附件与文件挂载」）。
3. `getSession` 从 `attributes.resources` 回读挂载，作为 UI 回显的 provider 真相；
   本地 `kit_sessions.files_json` 是冗余索引（provider 不可达时仍可显示）。
4. **上游修复后应删除 `bailian-rest.ts`**：当 SDK 把 `type: "file"` 改成 `file_resource`
   且允许传远端 agent id（或提供等价入口）时，回到 `createSessionForAgent`。
   跟踪点见 `apps/server/AGENTS.md` 不变量 7。

## 2026-11-02 追测：运行时挂载端点存在（推翻「无中途挂载」结论）

> 官方文档 2026-10-09 起披露会话资源运行时端点（session-resource-create / session-resource-list）；
> 2026-10-14 实测只覆盖了建会话形状，「没有中途挂载 API」仅对 SDK 0.8 公开面成立
> （`SessionUpdateInput` 至今只有 `title/metadata`）。探针脚本（一次性，已清理全部测试资源）：
> `.scratch/probe-session-resource-mount.mts` / `probe-session-resource-list.mts`。

| 端点 | 实测请求 | 结果 | 关键回显 |
| --- | --- | --- | --- |
| `POST /sessions/:id/resources` | `{ type: "file", file_id, mount_path: "/uploads/<name>" }` | 200 | `{ id: "sesrsc_…", type: "file", file_id: <内部副本，≠上传原 id>, mount_path: "/mnt/session/uploads/<name>", memory_store_id/access/instructions/name/description: null, created_at, updated_at }` |
| 同上（反例） | `mount_path: "/mnt/session/uploads/…"` | 400 `invalid_parameter`：`must be an absolute path under /uploads/` | — |
| `GET /sessions/:id/resources` | — | 200 | `{ data: [资源对象], request_id }` |
| `GET /sessions/:id/resources/:id` | — | 200 | 单资源对象 + `request_id` |
| `DELETE /sessions/:id/resources/:id` | — | 200 | `{ id, type: "session_resource_deleted", request_id }`，清内部副本；list 复查为 `[]` |
| `GET /sessions/:id`（挂载后） | — | 200 | **`resources` 仍为 `[]`**——运行时挂载不进会话详情回显 |

补充事实：

- 运行时挂载的资源 `type` 值是 `"file"`，与建会话回显的 `"file_resource"` 不同源；同一会话
  详情里建会话挂载进 `resources`、运行时挂载不进——两套挂载在 provider 侧可见性不对称；
- `file_id` 回显是**内部副本** id（`file_xxx` ≠ 上传原 id）；unmount 时清理副本，会话 DELETE
  时随之清理；文件须扫描 `available` 后才可挂载（本轮实测 15~30s，沿用扫描闸门）；
- 挂载/卸载**不产生会话事件**；`mount_path` 请求侧必须以 `/uploads/` 开头，服务端回显自动
  补全为 `/mnt/session/uploads/…`。

对 kit 的影响（实施时约束）：

1. 「附件只能在创建会话时挂载」与「Provider 没有中途挂载 API」的既有断言（docs/protocol.md
   「附件与文件挂载」、apps/server AGENTS.md 不变量 7、`src/routes/kit.ts` 的 messages 400 拒绝）
   **已过时**，随实现修订；实施后「已有会话 + 暂存附件」可走运行时挂载，不再强制新建会话；
2. SDK 侧已落地公开 API：上游仓库 OpenAgentPack 分支 `feat/session-runtime-resource-mount`
   （基于 `feat/sdk-sse-adaptation` @ 66f892f）新增
   `mountRemoteSessionResource` / `listRemoteSessionResources` / `getRemoteSessionResource` /
   `unmountRemoteSessionResource` 与 `SessionResourceInfo.id`，kit 经 tarball 交付
   （`.scratch/openagentpack-sdk-0.8.0.tgz`，sha256 `da78952e…`，经 root `package.json` 的
   `pnpm.overrides` 本地生效，不入版本库）；kit 不再为运行时挂载开 REST 窄口子，`bailian-rest.ts` 仅供创建时挂载；
3. `mount_path` 两套前缀约定：建会话收完整路径 `/mnt/session/uploads/…`，运行时只收
   `/uploads/…`——SDK 适配层已内建前缀剥离（接受完整路径或 `/uploads/…`，其余客户端拒绝），
   kit 侧统一约定不变；
4. 「挂载映射以 Provider 回显（getSession `attributes.resources`）为准」对运行时挂载不成立：
   provider 详情与事件均不回显，`kit_sessions.files_json` 是唯一展示权威（发送成功后由
   会话服务追加；未实现 list 对账，若后续补做需同时接受 `type: "file"`）；
5. 未测项：运行时挂载后 agent 在下一轮是否真实读到沙箱文件（挂载不产生事件，无从 API 层判断；
   留待实现后体验页实测，验收标准 = 发消息让 agent 读取挂载文件内容）。

## 2026-11-03 追测：沙箱物化判定（创建时挂载不物化，运行时挂载可见）

> 探针 `.scratch/probe-mount-sandbox-visibility.mts`：同一文件、同一 mount_path，A/B 两相对照，
> agent（qwen3-max，带 bash 工具）执行
> `ls -la /mnt/session/uploads/ && cat /mnt/session/uploads/<file>` 并原样回报。
> bash 工具会触发 `tool_approval_request`（`stop_reason: requires_action`），探针按 kit 同款
> 形状自动回 `tool_approval_response`（allow）后回合才推进——这也解释了此前几轮探针
> 「tool_use 之后永远没有 tool_result」的假象：不是 provider 不执行，是审批没人批。

| 相 | 挂载方式 | provider 回显（attributes.resources） | agent bash 实测 |
| --- | --- | --- | --- |
| A | 运行时挂载 `POST /sessions/:id/resources`，type `file` | `[]`（不回显） | **可见 ✓**：`ls` 列出文件、`cat` 打出标记内容，exit_code 0 |
| B | 创建时挂载 `POST /sessions`，resources type `file_resource` | 有绑定（sesrsc_…，mount_path 原样） | **不可见 ✗**：`ls: cannot access '/mnt/session/uploads/': No such file or directory`，exit 2 |

结论与约束：

1. 创建时挂载是「API 接受 + 详情回显，但沙箱永不物化」的**假挂载**——比 400 更隐蔽；
   一切需要 agent 真读到文件的场景必须走运行时挂载；
2. 运行时挂载在建会话后、首条消息前完成即可（A 相挂载与发送之间无消息），物化时机随挂载
   立即生效，不需要等首条消息；
3. kit 数据面相应调整：`GatewayCreateSessionInput` 移除 `files`，服务层在建会话后逐个
   `mountSessionResource`（失败回滚已挂载并删除刚建的会话）；`bailian-rest.ts` 窄口子只承载
   版本绑定与 memory_store 资源；
4. 未测项：创建时挂载对「文件归属/配额/详情展示」是否仍有价值（本 kit 不依赖它，不追）。

## 2026-11-03 追测：上传文件类型/体积合同（.mjs 被 provider 扩展名闸门拒绝）

> 官方文档 https://docs.agent.bailian.aliyun.com/zh/api/managed-agents/file/upload 的静态合同：
> 单文件 ≤ 50MB、workspace 累计 ≤ 100GB、状态枚举 `checking/available/rejected/type_rejected`、
> `mime_type` 由服务端检测（客户端传值不作数）、保留 30 天；文档**没有公开类型白名单**。
> 探针 `.scratch/probe-upload-mjs.mts`：同一份内容分别以 `.mjs`（text/javascript）、`.txt`、
> `.mjs.txt` 三个文件名上传，成功者立即删除。

| 文件名 | 结果 |
| --- | --- |
| `kit-probe-<stamp>.mjs`（MIME text/javascript） | **415** `{"error":{"code":"11900014","message":"文件类型不被允许"}}` |
| 同上（MIME 省略，text/plain 兜底） | **415** 同上 |
| 同内容 `kit-probe-<stamp>.txt` | 201 成功 |
| 同内容 `kit-probe-<stamp>.mjs.txt` | 201 成功 |

结论与约束：

1. 类型闸门在**扩展名**而非 MIME：同字节内容换个扩展名即可通过，`mime_type` 传值不影响判定；
2. `.mjs`（以及推断同类模块扩展）是 provider 侧确定拒绝项，但**无公开黑名单**——后续遇到新的
   415 直接在 `UPLOAD_BLOCKED_EXTENSIONS` 补扩展名，不需要重查合同；
3. kit 侧前置拦截（`packages/protocol/src/api.ts` 的 `uploadTypeRejectionReason` /
   `uploadSizeRejectionReason`，服务端与前端共用同一份文案）：命中黑名单服务端 400
   `invalid_request`、前端不发网络请求；体积上限 `UPLOAD_MAX_BYTES = 20 MiB`（kit 收得比
   provider 合同的 50MB 更紧，服务端 `KIT_UPLOAD_MAX_BYTES` 缺省同源）；
4. 415 不再落 500：gateway `ApiError → KitError` 映射（`gateway/sdk.ts` 的
   `providerUploadError`），带 provider message 的 4xx 归 `invalid_request`、429/5xx 归
   `provider_error`（retryable）。
