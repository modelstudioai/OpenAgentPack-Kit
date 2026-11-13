# apps/server — Hono 应用工厂

## 不变量

1. **路由不直接调用 `@openagentpack/sdk`**：一律经 `src/gateway/`（`SdkGateway` /
   `MockGateway`）。上游 API 变化只允许改 gateway 层。
2. **凭据不出服务端**：`CredentialResolver` 只在 gateway 构造时使用；响应、日志、错误消息
   中不得出现 key（有脱敏过滤器与测试）。
3. **事件不落库**：SQLite 存临时资源声明、SDK state、成功证明和回执（ADR-0017），以及 catalog、已保存模版与预设包配置目录、成员目录、session 本地索引、成员累计用量数值快照与
   删除阶段、月度限额数值增量与请求幂等索引、兼容 Credits、operation、audit。用量按真实
   本地成员的 experience 会话汇总；同一会话采集替换累计快照，缺失不补零。月度限额由独立
   基线与增量账本控制后续发送，不将累计快照直接计入当月；不保存请求文本或事件正文。
   本地成员密码仅存随机盐和派生值（ADR-0010）；登录会话仅存令牌哈希、成员与有效期，
   上传文件仅存归属索引（ADR-0011）；不得保存密码、登录令牌明文或 Provider 凭据。
4. **破坏性动作两段式**：`apply` / `destroy` / `publish` / 上下架 / 删除会话缺少有效
   `confirm_token` 一律 `428 confirmation_required`；服务端不代替用户确认，无 `--yes` 旁路。
   确认令牌签名在 `services/confirm-token.ts`，Identity 与匿名 cookie 在 `identity/types.ts`；
   这些 server-only 实现不得下沉到 SDK `/protocol`。
5. **归属过滤**：数据面所有 session 读写按 `subjectId` 过滤；越权返回 `404`（不泄露存在性）。
   默认成员登录；只有显式 `KIT_AUTH_MODE=anonymous` 开放匿名访问。上传、挂载和下载同样
   检查归属；Artifact 由本人 Session 的 Provider 历史校验，不把事件正文复制入库。
   管理端预设包发现为按所选远端 Agent 的独立只读入口：经 Provider 凭据查询全部会话元数据与资源引用，
   不依赖或补写本地会话索引。Gateway 校验列表及详情的 Agent 绑定，不查询事件、不返回标题、环境变量、
   原始 metadata/attributes、记忆正文或凭据；资源最多并发读取 4 个会话。失败明确标记 complete=false，
   不将部分资源当作完整结果；响应 no-store，admin/auditor 可读，成员身份不可访问。
   预设包保存只由 admin 发起，重新核验 Agent 固定版本、所选资源归属和当前元数据，再写入独立配置目录。
   不信任浏览器提交的名称、挂载或权限，不读取资源正文或 Credential；创建页不能表示的数量、类型或冲突配置明确拒绝。
   持久化结果可由 admin/auditor 按 ID 读取，响应 no-store；不自动保存模版、调试、发布或上架。
   当前 UI 改用 `presetPacks.preview`：复用相同资源校验后只返回配置，不写 SQLite；保存/列表/按 ID 读取仅兼容旧流程。
6. **不假设同源是客户端的事，但 CORS 是服务端的事**：`KIT_CORS_ORIGINS` 白名单，
   自定义白名单需要支持本地动态端口时，显式加入 `http://127.0.0.1:*`。
7. **附件挂载只走运行时挂载**：创建时挂载（`POST /sessions` resources type `file_resource`）
   API 接受且详情回显，但**沙箱不物化**（2026-11-03 实测 agent bash 报 No such file or
   directory，见 `docs/research/bailian-session-file-mount.md`）——比拒绝更隐蔽，禁止把文件
   挂载放回创建载荷（`GatewayCreateSessionInput` 刻意没有 `files`）。唯一挂载入口是
   `mountSessionResource`（SDK `mountRemoteSessionResource`，provider
   `POST /sessions/:id/resources` type `file`，实测沙箱可见）：建会话附件由会话服务在创建后
   逐个挂载（失败回滚已挂载并删除刚建的 provider 会话），随消息附件在发送前挂载（发送失败
   自动卸载回滚）；`src/services/attachments.ts` 解析 mount_path。文件字节与事件正文一样
   **不进库**。
   运行时挂载不回显在 `GET /sessions/:id`，展示以 `kit_sessions.files_json` 为准。
   随消息挂载的附件另以发送响应 `event_ids` 落 `kit_sessions.message_files_json`，会话详情
   以 `message_files` 透出——provider 事件不带附件信息，刷新后历史气泡的附件展示只靠这条
   本地关联（event_ids 是索引不是正文，不违反事件不落库）。
   Catalog 可维护默认挂载文件的服务端白名单：保存时核实普通上传来源与可用状态；体验页
   请求附件仍先验证本人上传归属，再合并目录文件。默认文件不得登记为成员本人上传，
   也不放开直接下载、任意 `file_id` 或其他目录的挂载权限。合并去重后最多 10 项。
   Catalog 的 `memory_stores` 是管理员授予新体验会话的共享记忆挂载：保存时经 SDK 公开
   元数据接口验证未归档，每项指定只读或读写（默认读写）及可选说明，最多 8 项。成员请求
   不得覆盖库、权限或说明；列表与广场不透出记忆配置，成员 Agent 详情经网关只读库元数据
   （SDK 公开 `getMemoryStore`，不做条目扫描），投影名称与描述（`AgentMemoryStore`，不含
   库 ID、权限、说明或条目正文，描述再经记忆配置脱敏）；缺失或已归档的库跳过，查询失败
   整体省略。会话记忆正文不落库；显式创建新库的临时初始化声明遵循 ADR-0017。
   Catalog 的 `vault_ids` 最多 10 项，只存既有密钥库 ID。列表/保存校验仅用 SDK 公开 Vault
   元数据接口，排除已归档库；不读取 Credential 列表、详情或密钥。成员不能自行替换绑定，
   公开目录不得暴露库 ID；SDK 原样拼接 ID 的详情接口必须先阻止路径与查询字符。
   管理员/auditor 显式查看密钥库详情使用独立 `remote.vaults.get`，不复用选择或绑定校验触发查询。
   先通过 SDK 查询并核验 Vault ID 及归档状态，再经公开 `ProjectRuntimeContext.providers` 的
   `listCredentials` 读取密钥元数据；不引入内部路径导入或 REST 旁路。只投影密钥 ID、名称、变量名及
   生效域名，文本再次脱敏，不返回 auth、值、metadata、注入配置或 Provider 错误正文，不落库、不缓存。
   建会话仍走 `src/gateway/bailian-rest.ts` 窄口子，但只承载**版本绑定与记忆/密钥资源**
   （`resources[].type="memory_store"`、顶层 `vault_ids`、`agent:{id,version}`），
   原因与探针矩阵见 `docs/research/bailian-session-file-mount.md`：
   `createSessionForAgent` 只认 config 声明键、不认 catalog 里的远端 agent id；SDK 0.10.0
   仍不能传历史版本。记忆资源复用 SDK 公开 `SessionMemoryStoreResource`
   （`type:"memory_store"`），官方合同与 SDK mapper 证据见 `docs/research/catalog-memory-stores.md`；
   密钥库通过顶层 `vault_ids` 绑定，不放入 `resources`，证据见 `docs/research/catalog-vaults.md`；
   显式版本绑定 `agent: {id, version}` 的 mapper 缺口证据见
   `docs/research/2026-10-30-agent-version-binding.md`。这些扩展不新增其他 REST 直连路径或事件模型。
   **上游修复后必须删除该文件并回到 SDK 入口**；新增任何绕过 SDK 的 provider 调用都要先在
   `docs/research/` 留实测证据，再在本条登记。
8. **管控面角色分离**：`auditor` 只读。写方法的拒绝逻辑只在 `app.ts` 的 `/api/admin/*`
   中间件里（一处），不要逐路由加判断——那样新增路由一定会漏。审计主体一律用
   `requireAdmin()` 返回的令牌指纹，禁止写死 `"admin:console"`，也禁止落令牌原文。
   `admin.audit.list` 从认证上下文取得主体，在 SQL 查询和总数统计前过滤，只返回本人记录；
   不接受客户端指定其他主体，成员和无主体记录不进入管理端日志列表。
   操作日志持久化入口只允许智能体新建、编辑、删除、上架和下架（含旧目录兼容接口）；
   写入与查询共用白名单。资源草稿/发布过程、成员/组、限额、登录、文件、会话等其他动作一律忽略，
   旧非白名单记录不进入列表或总数，不删除历史数据库记录。
9. **上下架也是破坏性动作**：`PATCH /api/admin/agents/:slug` 改 `status` 必须带
   `plan_id` + `confirm_token`（先 `POST .../plan`），缺令牌 400、伪造/重放 428。
10. **指标 label 只能是路由模板/方法/状态码**：不得把 session id、file id、slug、令牌、
    事件正文或用户输入写进 label（基数爆炸 + 泄露）。
11. **资源批次只使用 YAML 对象入口（ADR-0018）**：Kit 不提供目录 Project API、Build 或源码版本管理，
    不导入 SDK project-workspace/project-versions。Provider 凭据显式传入 SDK，Vault 密钥由批次内存解析，
    禁止运行链路写入全局环境变量。部署配置仍可读取环境变量。依赖规则为 server-no-directory-sdk。
12. **plan 的 diff 必须来自 SDK `planned.plan.actions`**：`resource` 用 `<type>:<name>`，
    `destructive` 取 `planned.destructiveActions`。空 diff 的 publish 等于让用户在
    看不见影响面的情况下确认，违反不变量 4 的精神。
13. **路由 schema 不得用 zod-openapi 渲染不了的类型**（`z.instanceof(File)`、`z.file()`）：
   一处失败会让**整份** `openapi.json` 退化成错误对象。二进制上传用
   `z.any().openapi({ type: "string", format: "binary" })`，运行时校验写在 handler 内。

14. **员工端品牌是单行服务端配置**：`kit_branding` 经管理端 `GET/PUT /api/admin/branding`
    读写，`GET /api/config` 只投影 `productName/logoUrl` 给匿名启动方。名称 trim 后 1–60 字；
    Logo 可用 `POST /api/admin/branding/logo` 上传 PNG/JPEG/WebP/SVG（≤512KB，二进制存
    `kit_branding_logo`），也可用 URL 模式填写单个 `/` 开头的本站路径或 http(s) 地址。
    上传后公开 `GET /api/branding/logo?v=<hash>` 读取图片；图片响应以 CSP sandbox 隔离，
    禁止脚本与外部资源加载，保留 SVG 内联样式，且设置 nosniff；PUT 省略 logoUrl 保持、`null` 清除、
    字符串切换 URL。auditor 只读，修改写 `branding.update` 审计；不得改回 Vite/.env 注入或
    向浏览器下发额外凭据。

15. **Session SSE 使用共享 pump**：发送消息/审批前等待上游订阅与分页历史合并就绪；
    `idle` / `requires_action` 不关闭连接。事件索引、变更游标与队列只驻内存，队列有上限，
    最后订阅者离开即取消上游；自然断流必须报告可恢复错误，不能伪装 `done`。
    模版预览复用 `admin_debug` 用途与主体隔离；`source=template` 在创建前复核远端 Agent、
    显式选择的环境及运行时资源元数据，使用既有创建窄入口，不伪造 Project 声明键。
    环境可省略，未选时不查询环境目录、不传 Provider 环境覆盖，使用智能体默认环境。
    模版完整更新省略环境即清除覆盖，同步关联 Catalog 时显式写 null；历史快照保留各版是否覆盖的语义。其选择的远端上传
    文件不要求由当前管理员上传，但不得补记上传归属或开放直接下载。仅保留模版调试与既有 Session 运行时操作。
    已保存模版由独立 `templates` store/service/routes 承载：保存前复核资源元数据与挂载配置，
    只持久化引用、显式 `agent_version` 绑定、分类、展示文案及受控名称/版本快照，不创建会话或上架条目。
    保存和更新必须提交合法 `category`，复用 `PlazaCategorySchema`；旧配置及历史缺失时按
    `general` 读取，不改写快照。上架、编辑及历史版本应用同步分类，不改变上下架状态或其他运营字段。
    `agent_version` 必须为正整数，省略使用最新版本；保存、上架及建会话时校验对应 Agent 的
    具体版本，失效或版本不匹配不能回退最新版本。`remote_agent_version` 只作历史展示快照。
    版本列表经 SDK 公开接口读取所有页，按版本去重并降序，只返回 `{version}` 元数据，异常或循环分页报错。
    管理员历史配置查看通过独立详情接口按需读取指定版本，核验 ID/版本一致后，仅投影模型、指令、
    工具、Skill、MCP、multiagent 及名称/描述/创建时间；优先 SDK 公开字段，历史 `attributes.config` 只回补白名单。
    SDK 将 Provider multiagent 放入公开 `CloudAgent.attributes`，该字段只读取名册，不透传其他原始属性。
    无损将 Provider 的字符串远端 ID 或 `{type:agent,id}` 转为 `{agent_id}`；Self 的 `id:null`、`version:null`
    按未设置省略，规范化为可编辑的 `{type:self}`；非空身份/版本与其他扩展仍原样保留供表单校验。
    固定版本和扩展字段原样保留并脱敏，供表单拒绝有损另存。目录仅补充可选 `is_coordinator` 标记，空名册表示关闭，不返回完整名册。
    Skill 引用优先保留已有可读名称（`name` / `skill_name` / `skillName`）；缺名或名称仅为 ID 时，
    经 SDK 公开 Skill 详情补全。具体版本必须查询并核验同一 ID/版本，无版本引用只查元数据；
    声明中的纯字符串名称不查询。按 ID/版本去重、限制并发，失败或不匹配保留原引用，不回退最新版。
    只补名称并再次经过原有脱敏投影，不从补全请求复制 Skill 正文、描述或原始属性。
    凭据、请求头、环境变量、命令参数及 URL 认证/查询信息在服务端脱敏，不返回原始配置或 metadata。
    用户指定的 Agent `description` 与 `instructions` 原文例外：原样返回，不运行通用文本脱敏/URL 裁剪，不因原文变化标记 `redacted_fields`；
    不影响模型、工具、MCP 等结构化字段的凭据脱敏。描述和指令写入仍遵循已有输入校验。
    模型内 `max_tokens` / `maxTokens` 是普通配置参数，数字、字符串及 `null` 均保留；其他 token 字段仍脱敏。
    环境详情经 SDK 公开 `getRemoteEnvironment` 只读获取，先校验安全 ID，再核验返回 ID 一致；
    缺失或归档返回 404，Provider 错误只返回固定安全摘要。详情仅投影名称、描述、作用域、版本、
    类型、时间与配置白名单（运行类型、网络策略、apt/pip/npm/go/cargo/gem 包）。仅从公开
    `attributes.package_status` 补充 `building` / `ready`，未知或缺失不推断就绪。`metadata`
    只取公开字符串映射：敏感键的值固定为 `[redacted]`，其余键/值经过文本与 URL 脱敏，不透传
    原始对象。变量只保留合法名称，所有值为 `[redacted]`；初始化脚本只返回该标记，不下发正文。
    每层排除未知字段，不返回 attributes 整包；admin/auditor 可读，查看不创建 Session 或改变环境绑定。
    详情 UI 展示概览、网络策略、预装包和元数据。SDK 证据见
    `docs/research/sdk-session-runtime.md`。
    新建资源由独立 `services/draft-resources.ts` 处理，使用 mutation 互斥、base_revision 乐观锁及 SDK 校验。
    `yaml-draft-gateway.ts` 仅保存当前批次 YAML 和 Kit revision，不返回服务器路径，不自动发布；成功保存使旧计划失效。
    环境输入复用 `ProjectEnvironmentCreateInputSchema`，拒绝未知字段与明文凭据；
    仅允许云端类型、描述、六类包和字符串元数据，不改变已有远端环境或 Agent 引用。
    智能体输入复用 `ProjectAgentCreateInputSchema` 的名称、描述、模型、指令、工具、Skill、官方 MCP、
    可选 multiagent 及 base_revision。SDK 公开 `buildAgentDecl` 与配置解析/校验保护 Agent 合同；
    指令原文按字面量处理，路径样正文不得转为服务器文件读取。multiagent 使用 SDK coordinator 合同，
    1–20 个去重的 `{type:self}`、本批逻辑引用或 `{agent_id}` 外部引用；Self 不建立普通自引用或受管资源依赖。
    不接管外部成员、不接受成员固定版本；编辑已发布资源沿用创建副本语义，不增加同 ID 升版。
    密钥库输入复用 `ProjectVaultCreateInputSchema`，允许省略 credentials 创建空库；
    密钥名称、变量名、生效域名、范围确认经共享 Schema 校验，类型固定环境变量，替换位置固定 HTTP 请求头。
    gateway 将值转换为随机引用，声明提交成功后才存入当前批次内存 Map。
    `yaml-draft-document.ts` 将 MA 凭据和密钥解析后的配置副本显式传入 SDK，关闭全局环境变量展开；
    YAML、SDK state、成功证明、回显和审计不保存明文，清理或丢弃只释放本批密钥。
    进程重启后未发布值失效，返回固定安全提示要求重新添加；完整成功后的收尾不再要求密钥。
    记忆库输入复用 `ProjectMemoryStoreCreateInputSchema` 的 base_revision、1–64 字名称和可选描述，
    初始化模式固定 initialize；条目最多 1000 项、单条 100 KiB、JSON 总计 512 KiB，逻辑路径不可重复或含 . / .. 段。
    初始化正文只在本批临时 YAML 中按字面量保存，由 SDK 在确认发布后创建新库并初始化，不读取任意本地文件，
    不修改原记忆库，不接受 metadata、来源文件路径或明文凭据。
    `remote.memoryStores.get` 仅在管理端显式导入或查看详情时经 SDK 完整读取条目，分页 limit=20、遍历子目录，
    检查去重、正文/归属/SHA；缺失、循环游标或读期间变化不得返回部分副本。
    批次记忆配置接口只读当前声明，并检查 revision 与 mutation 代次；只投影名称、描述、路径和正文，
    凭据式文本脱敏并标明复制限制。查询不缓存或持久化远端正文，不审计正文；原候选和绑定检查不读取条目。
    资源绑定 GET 枚举当前五类声明的有效 SDK state 身份，不限所选项；无绑定或缺少 Agent 具体版本时省略。
    按类型/声明键/Provider 精确匹配，只投影 ID/版本，读取前后检查 revision 和 mutation 代次；
    admin/auditor 可读，不联网或写入，不返回快照或凭据。POST 严格解析在未发布或不存在时拒绝。
    已有绑定不替代当前声明的 Plan；已关闭批次只能读取最小回执，不将回执还原为新批次 state。
    版本不存在或归档返回 404；admin/auditor 可读，无写入与 Session 创建。迁移 `023_catalog_agent_version_binding` 只新增 Catalog
    绑定列，不从快照回填绑定；模版 `config_json` 自然兼容该可选字段。列表与详情只读本地
    目录，Provider 离线仍可查看；所有管理身份可读，写操作沿用统一 auditor 拒绝规则。
    模版配置独立按整数版本保存：新建/旧数据迁移为 1，编辑校验 base_version，事务内追加
    不可变快照并更新当前配置、同步关联 Catalog；身份、上下架状态及其他运营字段保留。
    任一冲突全部回滚。员工新 Session 使用同步后的最新配置，已存在 Session 不替换运行时。
    模版版本列表按整数版本倒序分页，游标绑定模版 ID；版本详情只读对应不可变记录，返回该版
    保存时间，不合并当前目录状态或 Provider 数据。管理员与 auditor 均可读取，历史查询不写库。
    模版上架独立经过计划与确认，计划只读，确认前重新校验引用。一次性令牌绑定管理员、
    模版、目标展示名及 Catalog 当前配置；事务内写入条目与持久关联，取消或失败不留草稿。
    模版与现存条目一对一，已上架拒绝重复创建；下架后恢复模版配置并保留其他运营字段。
    模版删除经只读计划与一次性确认，绑定主体、目标和模版/关联 Catalog 快照；事务内重读
    校验后删除当前配置、全部历史、关联关系及关联 Catalog，冲突全部回滚。计划与删除不
    调用 Provider，不修改既有 Session；auditor 不可准备或执行删除。
15. **审批以当前 Provider 状态为准**：归属校验后按 `pending_batch_id/pending_call_ids` 匹配
    请求与已存在的响应；`session_thread_id` 从请求事件取，未知工具协议不允许执行。
    同 batch/call 串行去重；网络结果不明先查状态，不自动重发审批 POST。
16. **成员会话先保存用量才删除**：plan 与显式确认后阻止并发写入，确认运行或待审批的执行
    已结束，再读取最新累计值并持久化成功，才可发送 DELETE。停止 / 采集 / 落库失败均保留
    会话并提示重试；删除结果不明时保留封存快照与持久阶段，重启后也不能恢复新执行。
    不能用 DELETE 报错后的 GET 仍存在解除保护，也不能在重试采集时覆盖此前已发出 DELETE
    的持久阶段；发出 interrupt 后即使查到 idle，后续失败也保留保护，避免迟到请求影响新执行。
    该保护适用于真实本地成员的 experience 会话；删除成功后快照仍参与成员统计。
17. **模版向导只有 YAML 批次**：所有权、确认、SDK state 检查点、完整成功证明、最小回执和未知结果禁止重发
    继续遵循 ADR-0017；独立资源服务不依赖物理项目目录。旧目录批次由追加迁移原样归档，
    退出活动集合并释放所有者名额；原文件保留，不恢复、迁移或重新发布远端资源。File/Skill 继续使用受控上传暂存。
    MCP 只使用本批声明、显式填写或导入的配置，不读取历史主项目。清理失败单独收尾，不重复发布。

## 加一个新后端操作时（5 步，缺一不可）

1. `docs/interfaces.md` op 对照表登记（含状态列）；
2. `src/routes/*` 用 `@hono/zod-openapi` 的 `createRoute` 声明 schema；
3. `src/services/*` 实现（经 gateway / store，不直接碰 SDK 或 SQL 之外的东西）；
4. `pnpm gen:openapi` 重新生成 `openapi.json` 与 `packages/sdk/src/protocol/generated/openapi-types.ts`
   （根脚本已串起两步；漏跑会被 `tests/openapi.test.ts` 的漂移用例拦下）；
5. `tests/routes.test.ts` 补契约用例（成功 + 至少一条负向：越权 / 缺令牌 / 400 与 428 的区别）。

## 强制它的闸门

- dependency-cruiser：`server-must-not-depend-on-ui`（不得引入 react/chat-ui/web/console）；
- `pnpm check:docs`：`docs/interfaces.md` 的 ✅ 行与 `openapi.json` 路径**双向**一致
  （新增路由忘了登记、或文档标了未实现的路径，都会失败）；
- `tests/routes.test.ts`（路由与闸门）、`tests/gate.test.ts`（确认令牌）、`tests/buffer.test.ts`（事件缓冲）、
  `tests/hardening.test.ts`（角色分离 / 限流 / 请求体上限 / 附件扫描闸门 / 上下架闸门 / 指标）、
  `tests/attachments.test.ts`（挂载路径解析）、`tests/bailian-rest.test.ts`（REST 窄口子映射）、
  `tests/openapi.test.ts`（文档可渲染 + 未漂移）、`tests/contract.test.ts`（录制 fixture → 契约管道，
  防 sdk/mock 漂移）；
- `tests/live/smoke.ts` 的 `verifySessionLifecycle`：真实 workspace 上硬断言
  「建会话 → 挂载回显 → 归档 → 删除 → 删文件」，是 REST 窄口子唯一的端到端守护（`KIT_LIVE=1` 才跑）；
- `tests/fixtures/` 是**已脱敏**的真实 Provider 响应；重新录制用 `tests/live/record.ts`
  （只读，`KIT_LIVE=1` 才跑），脱敏白名单外出现明文字符串会被 contract 用例判失败；
- `pnpm gate` 中的 `check:docs` 会校验本文件与 interfaces.md 中命令真实存在。
